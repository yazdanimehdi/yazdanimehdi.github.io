---
title: 'Equi-mRNA: Protein Translation Equivariant Encoding for mRNA Language Models'
authors:
- Mehdi Yazdani-Jahromi
- Ali Khodabandeh Yalabadi
- Ozlem Ozmen Garibay
venue: arXiv preprint arXiv:2508.15103
year: 2025
url: https://arxiv.org/abs/2508.15103
type: journal
featured: true
abstract: The growing importance of mRNA therapeutics and synthetic biology highlights
  the need for models that capture the latent structure of synonymous codon (different
  triplets encoding the same amino acid) usage, which subtly modulates translation
  efficiency and gene expression. While recent efforts incorporate codon-level inductive
  biases through auxiliary objectives, they often fall short of explicitly modeling
  the structured relationships that arise from the genetic code's inherent symmetries.
  We introduce Equi-mRNA, the first codon-level equivariant mRNA language model that
  explicitly encodes synonymous codon symmetries as cyclic subgroups of 2D Special
  Orthogonal matrix (SO(2)). By combining group-theoretic priors with an auxiliary
  equivariance loss and symmetry-aware pooling, Equi-mRNA learns biologically grounded
  representations that outperform vanilla baselines across multiple axes. On downstream
  property-prediction tasks including expression, stability, and riboswitch switching
  Equi-mRNA delivers up to approximately 10% improvements in accuracy. In sequence
  generation, it produces mRNA constructs that are up to approximately 4x more realistic
  under Frechet BioDistance metrics and approximately 28% better preserve functional
  properties compared to vanilla baseline. Interpretability analyses further reveal
  that learned codon-rotation distributions recapitulate known GC-content biases and
  tRNA abundance patterns, offering novel insights into codon usage. Equi-mRNA establishes
  a new biologically principled paradigm for mRNA modeling, with significant implications
  for the design of next-generation therapeutics.
bibtex: "@article{yazdani2025equi, \n      title={Equi-mRNA: Protein Translation Equivariant\
  \ Encoding for mRNA Language Models},\n      author={Yazdani-Jahromi, Mehdi and\
  \ Yalabadi, Ali Khodabandeh and Garibay, Ozlem Ozmen},\n      journal={Neurips 2025},\n\
  \      url={https://arxiv.org/abs/2508.15103},\n      year={2025}\n}"
image: ../../assets/images/publications/equimrna.png
---
