---
title: 'HELM: Hierarchical Encoding for mRNA Language Modeling'
authors:
- Mehdi Yazdani-Jahromi
- Mangal Prakash
- Tommaso Mansi
- Artem Moskalev
- Rui Liao
venue: ICLR 2025; also Neurips 2024 Workshop on AI for New Drug Modalities
year: 2024
url: https://arxiv.org/abs/2410.12459
type: journal
featured: true
abstract: Messenger RNA (mRNA) plays a crucial role in protein synthesis, with its
  codon structure directly impacting biological properties. While Language Models
  (LMs) have shown promise in analyzing biological sequences, existing approaches
  fail to account for the hierarchical nature of mRNA's codon structure. We introduce
  Hierarchical Encoding for mRNA Language Modeling (HELM), a novel pre-training strategy
  that incorporates codon-level hierarchical structure into language model training.
  HELM modulates the loss function based on codon synonymity, aligning the model's
  learning process with the biological reality of mRNA sequences. We evaluate HELM
  on diverse mRNA datasets and tasks, demonstrating that HELM outperforms standard
  language model pre-training as well as existing foundation model baselines on seven
  diverse downstream property prediction tasks and an antibody region annotation tasks
  on average by around 8%. Additionally, HELM enhances the generative capabilities
  of language model, producing diverse mRNA sequences that better align with the underlying
  true data distribution compared to non-hierarchical baselines.
bibtex: "@article{yazdani2024helm,\n  title={HELM: Hierarchical Encoding for mRNA\
  \ Language Modeling},\n  author={Yazdani-Jahromi, Mehdi and Prakash, Mangal and\
  \ Mansi, Tommaso and Moskalev, Artem and Liao, Rui},\n  journal={ICLR 2025},\n \
  \ url={https://arxiv.org/abs/2410.12459},\n  year={2024}\n}"
image: ../../assets/images/publications/codon.png
---
