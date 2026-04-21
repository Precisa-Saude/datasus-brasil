# Política de Segurança

## Reportar uma Vulnerabilidade

Se você descobrir uma vulnerabilidade de segurança neste projeto, por favor reporte de forma responsável.

**Não abra uma issue pública no GitHub.**

Envie um e-mail para: **security@precisa-saude.com.br**

Inclua:

- Descrição da vulnerabilidade
- Passos para reproduzir
- Impacto potencial
- Correção sugerida (se houver)

Confirmaremos o recebimento em até 48 horas e forneceremos um cronograma para resolução.

## Escopo

Este projeto contém decoders de formato binário (DBC/DBF), cliente FTP e schemas de microdados públicos do DATASUS. Preocupações de segurança podem incluir:

- Vulnerabilidades no decoder (overflow, out-of-bounds read) ao processar arquivos DBC maliciosamente construídos
- Problemas de segurança no cliente FTP (SSRF, path traversal em cache)
- Vulnerabilidades em dependências
- Vazamento inadvertido de dados sensíveis em logs/mensagens de erro
