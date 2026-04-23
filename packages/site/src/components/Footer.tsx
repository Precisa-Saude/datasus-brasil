export function Footer() {
  return (
    <footer className="border-border bg-muted/30 border-t">
      <div className="text-muted-foreground mx-auto max-w-6xl px-4 py-6 text-sm">
        <p>
          Dados: <strong>DATASUS/SIA-SUS</strong> (Produção Ambulatorial, domínio público via Lei de
          Acesso à Informação). Geometrias: <strong>IBGE</strong> via{' '}
          <a
            className="underline"
            href="https://ipeagit.github.io/geobr/"
            rel="noreferrer"
            target="_blank"
          >
            geobr/IPEA
          </a>
          . Mapeamento LOINC ↔ SIGTAP: ANS + catálogo SBPC/ML refinado por LLM.
        </p>
        <p className="mt-2">
          Toolkit open-source sob licença Apache-2.0. Uso informativo e de pesquisa — não substitui
          análise epidemiológica profissional.
        </p>
      </div>
    </footer>
  );
}
