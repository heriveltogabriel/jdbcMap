# JdbcMap

Mapa de quais servidores de aplicação usam quais drivers JDBC e quais bancos Oracle eles acessam. Ele confronta o driver, o JDK e o servidor com as matrizes de certificação da Oracle e sugere o que migrar.

Lê a exportação de inventário do Java Assessment (formato `java-assessment-inventory`, versão 2). Tudo roda no navegador: o JSON é lido localmente e fica no IndexedDB, e nada é enviado para fora. Por isso as exportações do cliente (hostnames, IPs, nomes de serviço) **não entram no repositório**; `inventario*.json` está no `.gitignore`.

## Como usar

Precisa do [Node.js](https://nodejs.org) 22.12 ou mais novo (o Vite aceita a partir do 20.19, mas os testes pedem o 22).

```sh
git clone https://github.com/heriveltogabriel/jdbcMap.git
cd jdbcMap
npm install
npm run dev
```

Abra o endereço que o comando mostrar (normalmente `http://localhost:5173`).

Para só servir o app, sem desenvolver:

```sh
npm run build                       # confere os tipos e gera dist/
cd dist && python3 -m http.server   # ou qualquer servidor de arquivos estáticos
```

A pasta `dist/` é estática e pode ser copiada para qualquer servidor. Abrir o `index.html` com duplo clique não funciona, porque o navegador bloqueia scripts de módulo em `file://`.

### Passo a passo na tela

1. Aba **Coletas e dados**: arraste o JSON exportado. A prévia mostra versão do dashboard, data e contagens antes de importar.
2. Escolha **Substituir tudo** ou **Adicionar às coletas guardadas** (mantém as 5 mais recentes por padrão).
3. Cole o **catálogo de bancos** na lateral, no formato `host;versão`, uma por linha (`dbscan1.example.net;19c`). O inventário não traz a versão do banco; sem o catálogo o mapa mostra só driver e destino. O botão **Listar bancos** monta a lista de hosts a preencher.
4. Use o **Mapa de fluxo** (SO → servidor → JDK → driver → banco), a **Matriz driver × banco** (clique numa linha para ver os destinos de migração) e o **Plano de migração**.

Na coleta nova, importe de novo. **Substituir tudo** apaga a base anterior; **Adicionar** mantém para comparação. A aba de dados também tem **Limpar inventário**, **Limpar catálogo de bancos** e **Restaurar regras**, cada um com segunda confirmação.

## O que o app confere

- **Driver × banco:** a conexão fica certificada, certificada com versão fora de suporte, ou sem certificação da Oracle.
- **Servidor × JDK e banco:** para o WebLogic de 10.3.6 a 15.1.1, marca "fora do certificado" quando o JDK ou o banco não consta na certificação do My Oracle Support.
- **JDK 6 e 7:** o ojdbc8 exige JDK 8 ou mais novo. Nesses servidores o app não sugere o ojdbc8; diz que é preciso subir o JDK antes.
- **Jar antigo sem versão resolvida:** com `ojdbc14`, `ojdbc6` ou `ojdbc7`, sugere a migração pelo nome do jar.
- **Driver de fábrica do WebLogic 12.2.1.4:** avisa quando o driver não é o ojdbc8 19.3 que vem com o servidor.

O My Oracle Support certifica o servidor com o JDK e o banco, e não com o jar ojdbc. Por isso o app não afirma que "o WebLogic X suporta o ojdbc8"; ele verifica o JDK que o jar exige e o banco da conexão.

## Regras como dados

- `src/rules/compat.ts`: matriz driver × banco e linhas por jar, dos JDBC Developer's Guide 19c, 21c e 26ai da Oracle (lidos em 2026-10-26). Valores: certificado (Yes), certificado com uma versão fora de suporte (Was) e **sem certificação** (✕). O ✕ não quer dizer que o driver não conecta; a Oracle só certifica bancos que ainda suporta, então um driver novo contra um banco antigo aparece como ✕ embora costume funcionar, sem suporte. As células em `INFERRED` (asterisco na tela) não constam literalmente nas docs lidas.
- `src/rules/weblogic.json`: JDK e bancos Oracle certificados por versão do WebLogic. É gerado, não editado à mão.
- `src/rules/env.ts`: o ambiente vem da letra na 5ª posição do hostname (`n121d004775` → `d` = Desenvolvimento, `h` = Homologação, `p` = Produção). A regra é editável na aba de dados e vale sem reimportar.

### Atualizar a matriz do WebLogic

Os dados vêm da exportação CSV da aba **Certifications** do My Oracle Support (exige login Oracle). Para atualizar:

1. Exporte o CSV de cada versão do WebLogic e salve em `matriz/weblogic/` com o nome `Oracle WebLogic Server (Version 12.2.1.4.0).csv`. O CSV não traz a versão; ela vem do nome do arquivo.
2. Rode `npm run matriz`. O script mantém só Oracle Database, Oracle JDK e driver Oracle JDBC Thin, e regrava `src/rules/weblogic.json`.
3. Rode `npm test` e suba a versão no `package.json`. O cabeçalho do app mostra `v` e a versão, e é assim que se sabe qual build está aberto.

## Testes

```sh
npm test                        # unitários (Vitest): importação, regras, análise, fluxo e armazenamento
npm run build && npm run e2e    # interface em Chrome real (Playwright); CHROME=/caminho/chrome se preciso
```

Há também um teste de paridade com o protótipo Python sobre exportações reais. Ele só roda com as variáveis apontando arquivos locais:

```sh
JDBCMAP_SAMPLE=/caminho/inventario.json JDBCMAP_FACTS=/caminho/facts.json npm test
```

## Limites

- A cobertura do mapa depende da coleta: só aparece driver onde o coletor o resolveu. A tela de dados mostra a cobertura e os motivos de quem ficou sem versão.
- A versão do banco não está no inventário; vem do catálogo digitado.
- A regra de servidor só existe para o WebLogic. Tomcat, JBoss e Spring Boot não têm matriz do My Oracle Support nesses dados.
- A base é por navegador, sem compartilhamento entre pessoas.
- Não há comparação lado a lado entre coletas; as coletas guardadas permitem alternar.
