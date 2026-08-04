# 测试技能流水线编排

## 功能测试链

```
① test-plan-generator ──→ ② test-scenario-analyzer
                                        ↓
                        ③ test-case-generator
                                ↓
                    ┌───────────┼───────────────┐
                    ↓           ↓               ↓
          ④ test-case-    ⑤ smoke-test-   ⑦ test-script-
            reviewer       selector         generator
                    ↓           ↓               ↓
                    ↓    ⑥ smoke-test-    ⑧ universal-
                    ↓      executor         test-rules
                    ↓                           ↓
                    └─────────→ ⑨ test-quality-analyzer
```

## 性能测试链（独立）

```
⑩ perf-plan-generator ──→ ⑪ perf-script-generator ──→ ⑫ perf-report-analyzer
```

## 与上游包的衔接（第二阶段）

```
kit page-spec ──→ ③ test-case-generator（页面维度用例）
kit api.md ────→ ⑦ test-script-generator（接口断言）
bd contract ───→ ③ test-case-generator（接口矩阵）
bd permissions → ③ test-case-generator（权限用例）
bd ServiceTest → ⑨ test-quality-analyzer（质量复用）
```
