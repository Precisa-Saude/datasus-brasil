export default function Sobre() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-24 pb-10 font-serif leading-relaxed">
      <h1 className="font-sans text-3xl font-bold tracking-tight">Sobre</h1>

      <section className="mt-8 space-y-4">
        <h2 className="font-sans text-xl font-semibold">O que é</h2>
        <p>
          Visualização geográfica interativa dos exames laboratoriais faturados ao SUS. Os dados vêm
          do <strong>SIA-SUS — Produção Ambulatorial (PA)</strong>, filtrados pelo grupo SIGTAP{' '}
          <code className="font-mono text-sm">02.02</code> (Diagnóstico em Laboratório Clínico) e
          cruzados com o catálogo LOINC da plataforma Precisa Saúde para expor os dados em termos de
          biomarcadores clínicos reconhecidos internacionalmente.
        </p>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="font-sans text-xl font-semibold">Fontes</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>DATASUS/SIA-SUS</strong>: microdados públicos do Sistema de Informações
            Ambulatoriais, baixados do FTP oficial (
            <code className="font-mono text-sm">ftp.datasus.gov.br</code>). Schema vintage SIA-PA
            2008+.
          </li>
          <li>
            <strong>Geometrias</strong>: shapefiles oficiais do IBGE distribuídos pelo projeto{' '}
            <a
              className="underline"
              href="https://ipeagit.github.io/geobr/"
              rel="noreferrer"
              target="_blank"
            >
              geobr (IPEA)
            </a>
            , simplificados para renderização eficiente no browser.
          </li>
          <li>
            <strong>LOINC ↔ SIGTAP</strong>: mapeamento derivado da tabela oficial TUSS↔SIGTAP da
            ANS, refinado por LLM (Gemini 3.1 Pro) para resolver colisões semânticas. 164
            biomarcadores do <code className="font-mono text-sm">@precisa-saude/fhir</code>.
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="font-sans text-xl font-semibold">Limitações conhecidas</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Sub-registro</strong>: o SIA-SUS depende do faturamento do estabelecimento ao
            SUS. Nem todo exame realizado aparece — problemas de BPA ou atrasos administrativos
            subestimam o volume real. Para análise sistemática, ver{' '}
            <a
              className="underline"
              href="https://pmc.ncbi.nlm.nih.gov/articles/PMC10508673/"
              rel="noreferrer"
              target="_blank"
            >
              PMC 10508673
            </a>
            .
          </li>
          <li>
            <strong>Cobertura LOINC</strong>: o enrichment cobre apenas os 164 biomarcadores do
            catálogo Precisa Saúde. Exames do grupo 02.02 fora dessa lista aparecem nas agregações
            brutas mas não têm equivalência LOINC exibida.
          </li>
          <li>
            <strong>Semântica dos valores</strong>: o eixo "volume" usa{' '}
            <code className="font-mono text-sm">PA_QTDAPR</code> (aprovada pelo SUS), que pode
            divergir da quantidade apresentada. Valores em reais correntes, sem correção
            inflacionária.
          </li>
          <li>
            <strong>Recorte geográfico</strong>: agregação pela UF do estabelecimento executor (
            <code className="font-mono text-sm">PA_UFMUN</code>), não pelo município de residência
            do paciente. Para análise de acesso a serviços, este é o recorte certo; para prevalência
            populacional, usar com cuidado.
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="font-sans text-xl font-semibold">Licença e uso</h2>
        <p>
          Software licenciado sob{' '}
          <a
            className="underline"
            href="https://www.apache.org/licenses/LICENSE-2.0"
            rel="noreferrer"
            target="_blank"
          >
            Apache-2.0
          </a>
          . Microdados do DATASUS são públicos (Lei de Acesso à Informação). Esta ferramenta é para
          uso informativo, educacional e de pesquisa — não substitui análise epidemiológica
          profissional nem decisões clínicas.
        </p>
      </section>
    </div>
  );
}
