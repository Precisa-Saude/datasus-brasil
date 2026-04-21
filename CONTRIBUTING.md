# Contribuindo

Obrigado pelo interesse em contribuir com o datasus-brasil!

## Como Contribuir

### Reportar Bugs

1. Verifique se o bug já foi reportado nas [Issues](https://github.com/Precisa-Saude/datasus-brasil/issues)
2. Abra uma nova issue com:
   - Descrição clara do problema
   - Passos para reproduzir
   - Comportamento esperado vs. obtido
   - Versão do pacote
   - Para problemas de decodificação, informe o dataset/vintage (ex: `CNES-ST SP 2024/03`) e anexe arquivo mínimo reproduzível

### Propor Melhorias

1. Abra uma issue descrevendo a melhoria
2. Aguarde feedback antes de implementar

### Pull Requests

1. Faça fork do repositório
2. Crie um branch: `git checkout -b feat/minha-feature`
3. Faça suas alterações seguindo as convenções em `CONVENTIONS.md`
4. Adicione ou atualize testes
5. Verifique que tudo passa:
   ```bash
   pnpm turbo run build typecheck lint test
   ```
6. Abra o PR com descrição clara

### Dados e Schemas

Contribuições envolvendo schemas de datasets DATASUS ou tabelas de labeling **devem citar a fonte oficial**:

- Dicionários de dados publicados pelo DATASUS
- Portarias do Ministério da Saúde
- Tabelas IBGE para códigos de município
- WHO ICD-10 e versões oficiais em pt-BR

**Não** aceitamos dados sem referência ou de fontes comerciais.

## Código de Conduta

Esperamos que todos os contribuidores mantenham um ambiente respeitoso e construtivo. Comportamento abusivo, discriminatório ou assediador não será tolerado.

## Licença

Ao contribuir, você concorda que suas contribuições serão licenciadas sob a [Apache License 2.0](LICENSE).
