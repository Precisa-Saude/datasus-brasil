# @precisa-saude/datasus-dbc

Decoder TypeScript puro de arquivos `.dbc` do DATASUS (xBase DBF + PKWARE DCL Implode). Browser e Node compatível, zero dependências nativas, licença Apache-2.0.

## Motivação

Microdados públicos do DATASUS são distribuídos em `.dbc` — um formato dos anos 90 sem spec oficial. O ecossistema hoje se resolve em R (`read.dbc`) e Python (`pyreaddbc`, `datasus-dbc`). Em JS/TS existia apenas um Node native addon AGPLv3. Este pacote preenche a lacuna com uma implementação limpa em TypeScript.

## Instalação

```bash
npm install @precisa-saude/datasus-dbc
```

## Uso (preview)

```ts
import { readDbcRecords } from '@precisa-saude/datasus-dbc';

const file = await fetch('...').then((r) => r.arrayBuffer());
for await (const record of readDbcRecords(new Uint8Array(file))) {
  console.log(JSON.stringify(record));
}
```

## API

Em desenvolvimento — ver [PRE-198](https://linear.app/precisa-saude/issue/PRE-198) M1.

## Referências

- Mark Adler, [`blast.c`](https://github.com/madler/zlib/blob/master/contrib/blast/blast.c) — implementação canônica de DCL Implode em C
- Daniela Petruzalek, [`DBC_FORMAT.md`](https://github.com/danicat/read.dbc/blob/master/DBC_FORMAT.md) — spec do envelope DBC
- [`pkwdcl.js`](https://github.com/ConspiracyHu/diskmag-onlinification-project/blob/master/common/pkwdcl.js) — port JS de referência

## Licença

[Apache-2.0](../../LICENSE)
