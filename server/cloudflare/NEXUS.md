# IA Pessoal NEXUS · Fase A

Protótipo para validação em branch isolada, baseado na 1.6.2 e no Issue #2. Use a migração com as tabelas `nexus_missions_v1` e `nexus_events_v1` somente em um banco de teste que já tenha o esquema da 1.6.2. O painel fica em **Projetos → NEXUS · Missões de engenharia**. O gateway exige a credencial existente do proprietário e um repositório da instalação autorizada. A prévia 1.6.2 publicada usa um banco isolado e não tem essa instalação configurada. Este PR não modifica a prévia nem a produção.

## Passagem manual e evidências

1. Com o arquiteto, escolha um UUID e registre visão, escopo e provas no Issue. Inclua `NEXUS-MISSION: <uuid>` no texto do Issue. Em Projetos, importe o brief e confirme a especificação. Campos `issue` e `repoId` são IDs numéricos do GitHub. `checks` deve conter os nomes exatos de checks obrigatórios do GitHub Actions, escolhidos pelo proprietário. O número do PR pode ser vinculado depois.
2. Inicie o Codex pelo produto disponível e compartilhe o Issue. Desenvolva na branch informada no brief. No PR, mantenha o mesmo marcador, repositório e branch de destino. Registre testes, evidências e rollback. O NEXUS confere Issue, PR e SHA por leitura autenticada. O adaptador tenta usar a permissão `Checks: read` somente se ela já existir. Se ela não existir, a avaliação registra CI indisponível e fica bloqueada. Não conceda permissões automaticamente.
3. Na Diretora, registre a verificação humana de cada eixo e critério. Cada declaração inclui o SHA, o resultado, a justificativa e a referência. Ela é atribuída ao proprietário autenticado. O gateway verifica identidade, formato e vínculo ao SHA. Ele não abre nem interpreta os artefatos apresentados pelo proprietário. CI verde por si só não valida critérios nem procedência do workflow.
4. O **Teste de Realidade** exige prova funcional e visual e uma avaliação de navegação, clareza, design, responsividade, acessibilidade e tarefas principais. Se houver problema relevante, registre falha com evidência e descreva a reprodução. Passe os pedidos de revisão exportados manualmente ao Codex. Uma nova iteração exige novo SHA e invalida as provas do SHA anterior.
5. O proprietário pode registrar aprovação somente após a Diretora confirmar os critérios e o gateway verificar novamente o SHA e o CI. Essa ação não publica software. O aplicativo exporta o relatório em JSON. O estado de publicação não é confirmado automaticamente.

### Brief de exemplo

```json
{
  "schema": 1,
  "id": "c0a00531-94df-4781-910e-f17ec2ac5581",
  "repoId": 1234,
  "issue": 2,
  "pr": null,
  "baseRef": "integracao-v1.6.2",
  "branch": "nexus-fase-a",
  "objective": "Concluir cadastro com leitor de tela",
  "constraints": ["Sem credenciais no relatório"],
  "nonGoals": ["Publicação automática"],
  "checks": ["Gateway e nucleo cognitivo", "TypeScript e testes Expo"],
  "criteria": [{"id":"cadastro","description":"Concluir cadastro","expectedEvidence":"Vídeo com navegação e envio"}],
  "maxIterations": 3
}
```

Para atestar um eixo além de UX, use `{axis, commit, status, url, reason}`. Os IDs dos eixos são `objective`, `correctness`, `experience`, `security`, `resilience` e `delivery`. Para um critério do brief, substitua `axis` por `criterion`. O painel gera os modelos de Teste de Realidade e pedido de correção.

## Escopo e validação

A API usa a mesma autenticação do gateway, histórico append-only, checagem de concorrência e idempotência. Validação e exportação não chamam modelos. Atribuições de agente são convenções do fluxo de trabalho. As ações autenticadas do painel são registradas como ações do proprietário.

ChatGPT e Codex precisam ser invocados. A leitura de metadados do GitHub não transmite pedidos do painel ao Codex. O ciclo autônomo pedido em Prova de Integração exige um canal oficial e autorizado para entregar a revisão, iniciar a correção e obter evidência da recepção. A suíte local injeta respostas GitHub de teste para exercer transições reais do Worker e do SQLite. Esses testes não comprovam integração ativa entre agentes ou provisionamento da GitHub App em um ambiente isolado. A instalação no iPhone e a validação visual de um fluxo autenticado seguem pendentes.

## Investigação da Diretora

**Investigar PR e gerar relatório** relê o SHA e os checks obrigatórios no GitHub e examina até três arquivos elegíveis fixados nesse commit. O relatório separa fatos observados, dúvidas e limites da amostra. Falhas de CI geram pedidos estruturados de correção. Heurísticas como a presença de um teste ignorado são hipóteses e não substituem a execução de testes. O código lido não é incluído no histórico ou no pacote de correção. Se o PR avançar durante a leitura, a auditoria deve ser reiniciada sobre o novo SHA.

O brief ainda pode ser importado como JSON. Evidências e correções têm ações e campos próprios no painel. O proprietário continua responsável pelas atestações externas e pela confirmação de UX. A auditoria não invoca modelos e não pode se autoaprovar.

**Compartilhar pacote para o Codex** exporta um contrato versionado `nexus.revision_request` com missão, SHA, branch, escopo e testes de aceite. O pacote indica entrega manual. Um transporte futuro precisa de autorização explícita, verificação do destinatário e do escopo, deduplicação e confirmação real de recebimento. O pacote não inicia uma sessão do Codex.

## Revisão assistida e executor local

A ação **Investigar com revisão assistida** solicita confirmação antes de enviar uma amostra de até três arquivos ao Workers AI. Ela exige a configuração gratuita existente, reserva no mesmo registro de inferências do gateway e permite uma auditoria assistida por dia e uma tentativa por missão/SHA. Códigos com padrões reconhecidos de credenciais não são enviados. O relatório descarta citações fora das linhas fornecidas. O conteúdo das amostras não é gravado no diário. As observações permanecem hipóteses e não contam como evidência independente, pedido autorizado ou aprovação.

O executor usa o Codex CLI oficial já autenticado via ChatGPT. Confira o pacote da Diretora e autorize seus bytes pelo SHA-256. Execute em um clone local do repositório com `origin` HTTPS do GitHub e a branch no SHA autorizado:

```sh
node scripts/nexus-codex.mjs pacote.json SHA256_AUTORIZADO /caminho/do/clone /diretorio/privado
```

Para ler o pacote diretamente do gateway, configure `NEXUS_GATEWAY_TOKEN` no executor local, informe o UUID da missão no lugar do arquivo e a origem HTTPS do gateway no último argumento. O hash é calculado sobre o JSON formatado com duas posições de indentação, sem quebra de linha final. Essa leitura aceita missões em `CHANGES_REQUIRED` e exige nova autorização se o pacote mudar. A credencial do gateway não é repassada ao Codex.

O executor cria uma árvore Git local isolada. Um recibo inicial registra a solicitação. `session_started` exige o evento real `thread.started` do CLI. `local_changes_present` exige a conclusão do turno e alterações observadas na árvore local. O recibo não comprova teste, correção aceita ou publicação. Revise as mudanças, envie um commit por um fluxo autorizado e use **Conferir Issue, PR e CI** para acompanhar o novo SHA. O executor não envia commits, não publica e não mantém um agente em execução contínua.

Validação desta revisão: o GPT-OSS 20B analisou uma amostra fictícia de carrinho vazio e citou a linha que devolvia 1. Um teste independente falhou antes da correção manual e passou depois. A chamada direta de avaliação registrou 18,35 Neurons. Os testes integrados exercitam a reserva, o descarte de citações inventadas, a propagação de hipóteses e a rejeição de um SHA divergente. O teste real do Codex CLI identificou autenticação existente, mas a inicialização falhou no diretório gerenciado somente leitura, antes de `thread.started`. O ciclo automático permanece sem validação.
