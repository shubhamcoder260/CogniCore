## 6. Discussion and Practical Implications

### 6.1 The "Zero-Tax" Governance Finding

A long-standing belief in software engineering for AI is that imposing security boundaries, AST validation, and query restrictions necessarily degrades model utility. Our results refute this assumption in Text-to-SQL:
$$\Delta EX = EX(C4) - EX(C0) = 62.00\% - 63.00\% = -1.00\% \quad (p = 0.71)$$
The 1.00% difference is statistically insignificant. In exchange for this negligible variation, the enterprise gains:
1. Complete mathematical certainty that no write operations (`DROP`, `DELETE`, `UPDATE`) can execute;
2. Complete structural containment of cross-tenant row-level access;
3. Elimination of 70.6% of unhandled database crashes;
4. Containment within a 1,000-row result buffer to prevent memory exhaustion.

### 6.2 Monotonic Self-Healing in Small Language Models

Recent work by Huang et al. [ICLR 2024] showed that large models often struggle to self-correct reasoning because attempts to fix errors inadvertently corrupt correct logic. In CogniCore, self-healing is strictly monotonic (0 regressions out of 183 queries). 

This stability is achieved because:
1. Self-healing is triggered **only upon physical execution errors** reported by the database engine (e.g., `no such column`), never on stylistic or speculative grounds;
2. The reflection prompt receives the exact SQLite error string alongside the true discovered schema;
3. If the model fails to produce a working query after 2 bounded attempts, the system declines gracefully rather than guessing.

### 6.3 Local-First Edge Viability

Deploying Text-to-SQL within enterprises frequently stalls due to cloud data sovereignty restrictions: organizations refuse to transmit customer schemas and query parameters across third-party cloud APIs. By demonstrating that an open-weight 7B model running on a commodity workstation achieves 62% accuracy while completely eliminating external egress, CogniCore proves the viability of private, on-premise AI data copilot deployments.

---

## 7. Limitations & Threats to Validity

1. **Schema Context Window Scaling:** CogniCore serializes discovered table schemas into the LLM context prompt. While effective for databases with $\le 20$ tables, enterprise schemas with hundreds of tables will overflow standard 4,096-token context windows, requiring dynamic vector-based schema pruning (e.g., CHESS [10]).
2. **Regex-Based PII Sensitivity:** Egress PII masking currently utilizes high-precision regular expressions. While achieving 100% recall on credit cards and structured IDs, it exhibits lower recall on unstructured personal names in conversational text.
3. **Database Dialect Coverage:** While CogniCore’s AST parser and connection managers support PostgreSQL and MySQL, the empirical Spider Sample B benchmark was evaluated exclusively on SQLite.

---

## 8. Conclusion

We presented **CogniCore**, a domain-agnostic, local-first enterprise natural-language-to-SQL copilot governed by three enforceable axioms: the LLM is never the source of truth, never performs arithmetic, and never holds authorization. 

Through an extensive empirical evaluation across 900 units on the held-out Spider Sample B benchmark and over 52,000 synthetic security vectors, we demonstrated that structural CTE shadowing, token-level auto-repair, and feedback-guided self-healing achieve **62.00% execution accuracy** on local 7B models, reduce runtime database crashes by **70.6%**, guarantee **zero regressions in self-healing**, and ensure **100% bitwise database immutability**. 

By proving that enterprise-grade security and containment can be enforced without sacrificing task accuracy, CogniCore establishes a practical, reproducible foundation for trustworthy, on-premise AI data analytics.

---

## References

[1] V. Zhong, C. Xiong, and R. Socher, "Seq2SQL: Generating Structured Queries from Natural Language Using Reinforcement Learning," *arXiv:1709.00103*, 2017.  
[2] T. Yu, R. Zhang, K. Yang, et al., "Spider: A Large-Scale Human-Labeled Dataset for Complex and Cross-Domain Semantic Parsing and Text-to-SQL Task," *Proc. EMNLP*, pp. 3911–3921, 2018.  
[3] J. Li, B. Hui, G. Qu, et al., "Can LLM Already Serve as a Database Interface? A Big Bench for Large-Scale Database Grounded Text-to-SQLs," *NeurIPS 36*, 2024.  
[4] F. Lei, J. Chen, Y. Ye, et al., "Spider 2.0: Evaluating Language Models on Real-World Enterprise Text-to-SQL Workflows," *Proc. ICLR*, 2025.  
[5] T. Yu, R. Zhang, M. Yasunaga, et al., "SParC: Cross-Domain Semantic Parsing in Context," *Proc. ACL*, 2019.  
[6] T. Yu, R. Zhang, A. Iyer, et al., "CoSQL: A Conversational Text-to-SQL Challenge Towards Cross-Domain Natural Language Interfaces to Databases," *Proc. EMNLP*, 2019.  
[7] C.-H. Lee, O. Polozov, and M. Richardson, "KaggleDBQA: Realistic Evaluation of Text-to-SQL Parsers," *Proc. ACL*, pp. 2261–2273, 2021.  
[8] M. Pourreza and D. Rafiei, "DIN-SQL: Decomposed In-Context Learning of Text-to-SQL with Self-Correction," *NeurIPS 36*, 2024.  
[9] D. Gao, H. Wang, Y. Li, et al., "Text-to-SQL Empowered by Large Language Models: A Benchmark Evaluation," *Proc. VLDB Endowment*, 17(5):1132–1145, 2024.  
[10] S. Talaei, M. Pourreza, Y.-C. Chang, A. Mirhoseini, and A. Saberi, "CHESS: Contextual Harnessing for Efficient SQL Synthesis," *arXiv:2405.16755*, 2024.  
[11] B. Wang, C. Ren, J. Yang, et al., "MAC-SQL: A Multi-Agent Collaborative Framework for Text-to-SQL," *arXiv:2312.11242*, 2023.  
[12] T. Scholak, N. Schick, and R. Dureau, "PICARD: Parsing Incrementally for Constrained Auto-Regressive Decoding from Language Models," *Proc. ACL*, 2021.  
[13] A. S. Pillai, "GROUND: Reducing Hallucinations in LLM-Based Enterprise Analytics Through Governed Semantic Definitions," *arXiv preprint*, 2026.  
[14] P. Lewis, E. Perez, A. Piktus, et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks," *NeurIPS 33*, 2020.  
[15] S. Robertson and H. Zaragoza, "The Probabilistic Relevance Framework: BM25 and Beyond," *Foundations and Trends in Information Retrieval*, 3(4), 2009.  
[16] S. Es, J. James, L. Espinosa-Anke, and S. Schockaert, "RAGAS: Automated Evaluation of Retrieval Augmented Generation," *Proc. EACL*, 2024.  
[17] S. Yao, J. Zhao, D. Yu, et al., "ReAct: Synergizing Reasoning and Acting in Language Models," *Proc. ICLR*, 2023.  
[18] T. Schick, J. Dwivedi-Yu, R. Dessì, et al., "Toolformer: Language Models Can Teach Themselves to Use Tools," *NeurIPS 36*, 2023.  
[19] L. Gao, A. Madaan, S. Zhou, et al., "PAL: Program-Aided Language Models," *Proc. ICML*, 2023.  
[20] W. Chen, X. Ma, X. Wang, and W. W. Cohen, "Program of Thoughts Prompting: Disentangling Computation from Reasoning for Numerical Reasoning Tasks," *arXiv:2211.12588*, 2022.  
[21] X. Chen, M. Lin, N. Schärli, and D. Zhou, "Teaching Large Language Models to Self-Debug," *Proc. ACL*, 2023.  
[22] J. Huang, X. Chen, S. Mishra, et al., "Large Language Models Cannot Self-Correct Reasoning Yet," *Proc. ICLR*, 2024.  
[23] K. Greshake, S. Abdelnabi, S. Mishra, et al., "Not What You've Signed Up For: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection," *Proc. ACM Workshop on AISec*, 2023.  
[24] R. S. Sandhu, E. J. Coyne, H. L. Feinstein, and C. E. Youman, "Role-Based Access Control Models," *IEEE Computer*, 29(2):38–47, 1996.  
[25] J. H. Saltzer and D. M. Schroeder, "The Protection of Information in Computer Systems," *Proc. IEEE*, 63(9):1278–1308, 1975.  
[26] F. Perez and I. Ribeiro, "Ignore Previous Prompt: Attack Techniques For Language Models," *NeurIPS Workshop*, 2022.  
[27] H. Touvron, T. Lavril, G. Izacard, et al., "LLaMA: Open and Efficient Foundation Language Models," *arXiv:2302.13971*, 2023.  
[28] Qwen Team, "Qwen2.5: A Party of Foundation Models," *arXiv preprint*, 2024.  
[29] S. Gunasekar, Y. Zhang, J. Aneja, et al., "Textbooks Are All You Need," *arXiv:2306.11644*, 2023.  
[30] H. Li, J. Zhang, H. Liu, et al., "CodeS: Towards Building Open-Source Language Models for Text-to-SQL," *Proc. ACM Management of Data*, 2(3):1–28, 2024.  
[31] M. T. Ribeiro, T. Wu, C. Guestrin, and S. Singh, "Beyond Accuracy: Behavioral Testing of NLP Models with CheckList," *Proc. ACL*, 2020.  
[32] F. T. Liu, K. M. Ting, and Z.-H. Zhou, "Isolation Forest," *Proc. IEEE ICDM*, 2008.  
[33] A. Radford, J. Wu, R. Child, et al., "Language Models are Unsupervised Multitask Learners," *OpenAI Technical Report*, 2019.  
[34] D. Hendrycks and K. Gimpel, "A Baseline for Detecting Misclassified and Out-of-Distribution Examples in Neural Networks," *Proc. ICLR*, 2017.
