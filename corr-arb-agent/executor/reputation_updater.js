const fs = require("fs-extra");
const path = require("node:path");

const REPUTATION_STATE_FILE = path.join(__dirname, "../data/reputation_state.json");

const MAX_CONSECUTIVE_LOSSES = Number(
  process.env.CIRCUIT_BREAKER_MAX_CONSECUTIVE_LOSSES || "3"
);
const CIRCUIT_BREAKER_PAUSE_SECONDS = Number(
  process.env.CIRCUIT_BREAKER_PAUSE_SECONDS || "3600"
);
const MAX_DRAWDOWN_PERCENT = Number(process.env.MAX_DRAWDOWN_PERCENT || "20");
const STARTING_PORTFOLIO_USD = Number(process.env.STARTING_PORTFOLIO_USD || "1000");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

class ReputationUpdater {
  constructor(filePath = REPUTATION_STATE_FILE) {
    this.filePath = filePath;
  }

  async loadState() {
    if (!(await fs.pathExists(this.filePath))) {
      return {
        score: 50,
        isPaused: false,
        pausedUntil: 0,
        outcomes: [],
        stats: {
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          totalPnlUsd: 0,
          sumPnlUsd: 0,
          sumSqPnlUsd: 0,
          consecutiveLosses: 0,
          maxConsecutiveLosses: 0,
          currentPortfolioUsd: STARTING_PORTFOLIO_USD,
          peakPortfolioUsd: STARTING_PORTFOLIO_USD,
          maxDrawdownPct: 0,
          updatedAt: new Date().toISOString(),
        },
      };
    }

    return fs.readJSON(this.filePath);
  }

  async saveState(state) {
    await fs.writeJSON(this.filePath, state, { spaces: 2 });
  }

  async recordOutcome({ tradeId, pnlUsd, metadata = {} }) {
    const state = await this.loadState();
    const stats = state.stats;

    const nowSec = Math.floor(Date.now() / 1000);

    if (state.isPaused && state.pausedUntil <= nowSec) {
      state.isPaused = false;
      state.pausedUntil = 0;
    }

    stats.totalTrades += 1;
    stats.totalPnlUsd += pnlUsd;
    stats.sumPnlUsd += pnlUsd;
    stats.sumSqPnlUsd += pnlUsd * pnlUsd;

    if (pnlUsd > 0) {
      stats.winningTrades += 1;
      stats.consecutiveLosses = 0;
    } else {
      stats.losingTrades += 1;
      stats.consecutiveLosses += 1;
      stats.maxConsecutiveLosses = Math.max(
        stats.maxConsecutiveLosses,
        stats.consecutiveLosses
      );
    }

    stats.currentPortfolioUsd += pnlUsd;
    stats.peakPortfolioUsd = Math.max(stats.peakPortfolioUsd, stats.currentPortfolioUsd);

    const drawdownPct =
      stats.peakPortfolioUsd > 0
        ? ((stats.peakPortfolioUsd - stats.currentPortfolioUsd) / stats.peakPortfolioUsd) * 100
        : 0;
    stats.maxDrawdownPct = Math.max(stats.maxDrawdownPct, drawdownPct);

    if (stats.consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
      state.isPaused = true;
      state.pausedUntil = nowSec + CIRCUIT_BREAKER_PAUSE_SECONDS;
    }

    state.score = this.computeScore(stats, drawdownPct);

    state.outcomes.push({
      tradeId,
      pnlUsd,
      recordedAt: new Date().toISOString(),
      scoreAfter: state.score,
      metadata,
    });

    if (state.outcomes.length > 500) {
      state.outcomes = state.outcomes.slice(-500);
    }

    stats.updatedAt = new Date().toISOString();

    await this.saveState(state);
    return state;
  }

  computeScore(stats, currentDrawdownPct) {
    if (!stats.totalTrades) {
      return 50;
    }

    const winRatePct = (stats.winningTrades / stats.totalTrades) * 100;
    const baseScore = (winRatePct * 60) / 100;

    let sharpeBonus = 0;
    if (stats.totalTrades >= 5) {
      const n = stats.totalTrades;
      const mean = stats.sumPnlUsd / n;
      const variance = Math.max(0, stats.sumSqPnlUsd / n - mean * mean);
      const std = Math.sqrt(variance);
      if (std > 0 && mean > 0) {
        const sharpe = mean / std;
        sharpeBonus = clamp(sharpe * 10, 0, 30);
      }
    }

    let drawdownPenalty = 0;
    if (currentDrawdownPct > MAX_DRAWDOWN_PERCENT) {
      drawdownPenalty = -20;
    } else if (currentDrawdownPct > 10) {
      drawdownPenalty = -10;
    }

    const streakPenalty = -5 * stats.consecutiveLosses;
    const rawScore = baseScore + sharpeBonus + drawdownPenalty + streakPenalty;
    return Math.round(clamp(rawScore, 0, 100));
  }

  getPositionMultiplier(score) {
    if (score < 30) return 0.25;
    if (score < 60) return 0.5;
    if (score < 80) return 0.75;
    return 1;
  }
}

module.exports = {
  ReputationUpdater,
  REPUTATION_STATE_FILE,
};
