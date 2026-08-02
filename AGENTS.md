# 项目约定

## 代码阅读

- 阅读/探索本项目代码时，**默认优先使用 codebase-memory MCP 知识图谱**（项目名 `dazhahui`），而非 grep/glob：
  - 找定义/实现：`search_graph`、`get_code_snippet`
  - 文本搜索并定位到函数：`search_code`
  - 查调用方/依赖/影响面：`trace_path`
  - 复杂多跳/聚合分析：`query_graph`
  - 整体架构概览：`get_architecture`
- 图谱信息过期（代码有大改动后）时，先用 `index_repository` 重新索引再查询。
