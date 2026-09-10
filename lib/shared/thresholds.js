/**
 * thresholds.js — 质量阈值单一事实源
 *
 * 此前 95% / 0.3 / ≤20% / P99<500ms 等魔法数字散落在 gate.js / quality-gate.js /
 * report-generator.js / test-codegen.js / index.js 等 8+ 处，口径漂移风险高。
 * 所有阈值集中在此，命令行/报告/门禁/MCP 共用。
 */

/** 冒烟/自动化通过率门禁（%） */
export const SMOKE_PASS_RATE = 95;

/** DI 密度上限（DI / 用例数） */
export const DI_MAX_DENSITY = 0.3;

/** 最差模块 DI 收敛上限（占总体 DI 比例） */
export const MODULE_CONVERGENCE_MAX_RATIO = 0.2;

/** 最差模块 DI 绝对豁免线（低于此值不计入收敛判定） */
export const MODULE_CONVERGENCE_ABS_EXEMPT = 3;

/** 性能 P99 SLA（ms） */
export const PERF_P99_SLA = 500;

/** 性能 P99 峰值放宽线（ms） */
export const PERF_P99_RELAXED = 1000;

/** 性能错误率上限（%） */
export const PERF_ERROR_RATE_MAX = 1;

/** 性能错误率阻断线（%） */
export const PERF_ERROR_RATE_BLOCK = 5;

/** 性能基线对比默认阈值（% 劣化容差） */
export const PERF_COMPARE_THRESHOLD = 15;

/** 性能基线错误率绝对上升容差（百分点） */
export const PERF_COMPARE_ERROR_PP = 1;
