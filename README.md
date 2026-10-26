# JdbcMap

Mostra quais servidores de aplicação usam quais drivers JDBC e quais bancos Oracle eles acessam, e confronta driver e banco com a matriz de certificação da Oracle para sugerir migrações. Lê a exportação de inventário do [Java Assessment](../JavaAssessment-2.1.8) (formato `java-assessment-inventory`, versão 2).

Tudo roda no navegador: o JSON é lido localmente e fica no IndexedDB do navegador. Nada é enviado para fora. Por isso as exportações do cliente (hostnames, IPs, nomes de serviço) **não entram no repositório** (`inventario*.json` está no `.gitignore`).

## Uso

```sh
npm install
npm run dev      # servidor de desenvolvimento
npm run build    # confere tipos e gera dist/ (abre em qualquer servidor estático)
```

1. Aba **Coletas e dados**: arraste o JSON exportado. A prévia mostra versão do dashboard, data e contagens antes de importar.
2. Escolha **Substituir tudo** ou **Adicionar às coletas guardadas** (mantém as mais recentes, 5 por padrão).
3. Cole o **catálogo de bancos** (`host;versão`, uma por linha) na lateral. O inventário não traz a versão do banco; sem o catálogo o mapa mostra só driver e destino.
4. Use o **Mapa de fluxo** (SO → servidor → JDK → driver → banco), a **Matriz driver × banco** (clique numa linha para ver os destinos) e o **Plano de migração**.

### Nova coleta

Importe de novo. Com **Substituir tudo** a base anterior é apagada; com **Adicionar** ela é mantida para comparação. A aba **Coletas e dados** também tem:

- **Limpar inventário**: apaga as coletas; o catálogo de bancos e as regras ficam.
- **Limpar catálogo de bancos** e **Restaurar regras**, cada um separado.

Cada limpeza pede uma segunda confirmação.

## Regras como dados

- `src/rules/compat.ts`: matriz driver × banco e linhas por jar. Vem dos JDBC Developer's Guide 19c, 21c e 26ai da Oracle (lidos em 2026-10-26). Valores: certificado (Yes), certificado com uma versão fora de suporte (Was), não listado pela Oracle e não verificado. As células em `INFERRED` não constam literalmente nas docs lidas; a doc do 23ai só foi lida por resumo. **Conferir antes de tratar como regra definitiva.**
- `src/rules/env.ts`: o ambiente vem da letra na 5ª posição do hostname (`n121d004775` → `d` = Desenvolvimento, `h` = Homologação, `p` = Produção). A regra é editável na aba de dados e vale sem reimportar. O ambiente cadastrado pelo cliente é guardado só para apontar divergências.

## Testes

```sh
npm test                 # unitários (Vitest): importação, regras, análise, fluxo e armazenamento
npm run build && npm run e2e   # interface em Chrome real (Playwright); CHROME=/caminho/chrome se preciso
```

Há também um teste de paridade com o protótipo Python sobre exportações reais. Roda só com as variáveis apontando arquivos locais:

```sh
JDBCMAP_SAMPLE=/caminho/inventario.json JDBCMAP_FACTS=/caminho/facts.json npm test
```

## Limites

- A cobertura do mapa depende da coleta: só aparece driver onde o coletor o resolveu. A tela de dados mostra a cobertura e os motivos de quem ficou sem versão.
- A versão do banco não está no inventário; vem do catálogo digitado.
- A base é por navegador (sem compartilhamento entre pessoas).
- Não há comparação entre coletas ainda; as coletas guardadas permitem alternar, não comparar lado a lado.
