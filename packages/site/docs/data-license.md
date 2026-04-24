# Licença, atribuição e procedência dos dados

Este documento descreve a base legal da redistribuição dos agregados
SIA-PA por este repositório, a licença aplicada aos nossos derivados e
como citar formalmente o dataset.

## Procedência

Os arquivos Parquet publicados em `parquet-opt/` são derivados do
subdataset **SIA-SUS Produção Ambulatorial (PA)**, distribuído pelo
Ministério da Saúde via DATASUS em `ftp.datasus.gov.br/dissemin/publicos/SIASUS/`.

O pipeline aplica:

1. Download dos `PA{UF}{YYMM}.dbc` via FTP anônimo (cache local).
2. Decodificação DBC (PKWARE DCL Implode) → DBF (dBase) via
   `@precisa-saude/datasus-dbc`.
3. Filtro SIGTAP grupo **02.02 — Diagnóstico em Laboratório Clínico**.
4. Enriquecimento com códigos LOINC via
   `@precisa-saude/datasus` (bridge `sigtapToLoinc`).
5. Agregação `(ufSigla × municipioCode × loinc × competencia)`.
6. Consolidação e compressão em Parquet + zstd.

Cada partição publicada tem um arquivo
`provenance/ano=YYYY/uf=XX/part.provenance.json` com:

- SHA256 de cada DBC-fonte usado
- Caminho FTP original
- `gitSha` do commit do pipeline que gerou a partição
- Versão do decoder e do SDK de leitura
- Row-count de entrada e saída

Pesquisadores podem reexecutar o pipeline no gitSha indicado e validar
que o Parquet bate byte-a-byte com o publicado.

## Base legal da redistribuição

Os microdados do SIA-SUS são de domínio público sob o regime da
**Política de Dados Abertos do Poder Executivo Federal**:

- **Lei 12.527/2011** (Lei de Acesso à Informação) — art. 8º estabelece
  que dados sob gestão do Estado devem ser disponibilizados em formato
  aberto, estruturado e livre para uso, redistribuição e criação de
  derivados.
- **Decreto 8.777/2016** — institui a política de dados abertos para o
  Poder Executivo; exige publicação em formatos abertos, com licença
  compatível com redistribuição irrestrita.
- **Portaria MS nº 356/2022** e documentos do DATASUS — reafirmam que
  microdados agregados por essa via são "dados abertos" para uso
  livre, incluindo uso comercial e produção de derivados, desde que
  preservada a procedência.

**LGPD (Lei 13.709/2018)**: aplica-se a dados pessoais. Os agregados
que publicamos são no nível `(UF × município × LOINC × mês)` — não
identificam indivíduos, não contêm dados sensíveis de saúde
individual, não se enquadram no escopo da LGPD para o titular.

## Licença da nossa agregação

Os Parquet e manifestos produzidos por este pipeline são publicados
sob **Creative Commons Attribution 4.0 International (CC-BY 4.0)**
— https://creativecommons.org/licenses/by/4.0/.

Permitido:

- Uso para qualquer finalidade (incluindo comercial)
- Redistribuição
- Criação de trabalhos derivados (visualizações, análises, publicações)

Requerido:

- Atribuição (ver seção de citação abaixo)
- Indicação de alterações feitas aos derivados

Os dados brutos (DBC) continuam sob o regime da Lei 12.527 e Decreto
8.777 — não aplicamos CC-BY sobre eles, apenas sobre os agregados que
produzimos.

## Como citar

Em publicações acadêmicas (formato ABNT):

> PRECISA SAÚDE. **datasus-brasil — Agregados SIA-PA**. Versão
> `dataset-YYYY-MM`. São Paulo: Precisa Saúde, 2026. Derivado do
> SIA-SUS Produção Ambulatorial (DATASUS, Ministério da Saúde). DOI:
> `10.5281/zenodo.XXXXX`. Disponível em:
> https://github.com/Precisa-Saude/datasus-brasil/releases/tag/dataset-YYYY-MM.
> Acesso em: YYYY-MM-DD.

Em citações informais / READMEs de outros projetos:

> Dados: SIA-SUS/DATASUS (fonte original), agregados por
> `precisa-saude/datasus-brasil` sob CC-BY 4.0.

O arquivo `CITATION.cff` na raiz do repositório contém a versão
estruturada (compatível com Zenodo, Zotero, GitHub "Cite this
repository").

## Limitações conhecidas

- **Sub-registro do SIA**: o SIA-SUS reflete apenas o que foi
  faturado ao SUS. Exames da rede privada, SUS municipalizado sem
  faturamento centralizado, ou procedimentos pagos diretamente não
  aparecem.
- **Schema vintage**: a estrutura do PA mudou em 2008. Agregações
  pré-2008 (quando existirem) usarão schema diferente e devem ser
  tratadas separadamente.
- **São Paulo (SP)**: em meses de alta produção, o DATASUS divide os
  arquivos em `PASP{YY}{MM}{a,b,c}.dbc`. Enquanto o core do pacote
  não suporta split files, SP fica ausente de algumas competências.
- **Códigos de município**: mantidos em 6 dígitos (sem dígito
  verificador, como no SIA). Para cruzar com IBGE `codigo_ibge`
  (7 dígitos), usar a tabela `municipios` do
  `@precisa-saude/datasus` que casa pelos primeiros 6 dígitos.

## Fonte oficial para validação

Pesquisadores que queiram auditar ou reexecutar o pipeline:

- FTP DATASUS: `ftp://ftp.datasus.gov.br/dissemin/publicos/SIASUS/200801_/Dados/`
- TabNet interface: http://tabnet.datasus.gov.br/cgi/tabcgi.exe?sia/cnv/qauf.def
- Nota técnica SIA (escopo e limitações): veja `docs/data-pipeline.md`
  e referências PMC listadas no README raiz.
