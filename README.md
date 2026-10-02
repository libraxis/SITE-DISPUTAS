# ST Processos 2.0

Interface inspirada no painel ST Cotações, agora dedicada à busca de processos/contratações públicas.

## Fontes
- PNCP — API pública de consulta, sem login.
- Compras.gov.br — API oficial de Dados Abertos para contratações do regime PNCP/Lei 14.133.

## Funcionalidades
- Aba **Busca de Processos**.
- Busca por palavra-chave/item, UF, cidade, modalidade e modo de disputa.
- Situações: recebendo propostas, somente publicados ou ambos.
- Período de publicação de até 365 dias.
- Consolidação e deduplicação entre PNCP e Compras.gov.br.
- Botão **Detalhes** com dados da contratação, órgão, unidade, datas, valores, modalidade, disputa, base legal, links, documentos, itens e histórico quando publicados pelas APIs.
- Link **Visualizar no PNCP**.
- Link para o sistema de origem quando o edital informa a URL.
- Cache em memória e retry para reduzir chamadas repetidas e tolerar instabilidades temporárias.

## Executar

```bash
npm install
npm start
```

Abra `http://localhost:3000`.

Não há `swagger.json` nem integração com Banco de Preços nesta versão.
