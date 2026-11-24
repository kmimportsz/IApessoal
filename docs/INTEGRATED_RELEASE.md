# IA Pessoal | Candidata integrada

A branch `release/ipe-integrada` descende da versão 1.6.2 e reúne as entregas Factory, Change Lab, Design Studio, Knowledge Core, Delivery Center, Quality Gate, Recovery e NEXUS.

## Fluxo integrado

1. Prepare o briefing na Factory e selecione Vincular briefing a uma entrega.
2. Confira o conteúdo, escolha o repositório autorizado e informe o Issue, PR e critérios de aceite. A transferência é local até confirmar a conferência.
3. O gateway autentica o proprietário, valida o escopo e retorna o SHA atual. Confirme Criar missão e conferir entrega para registrar a entrega existente e auditar o mesmo SHA em uma ação. Não há chamada de modelo nessa ação. CI pendente continua pendente; evidências ausentes continuam bloqueando o aceite.
4. O briefing fica no registro da missão. O pacote para os agentes preserva esse contexto. A execução observada no GitHub não comprova autoria de um agente. O proprietário decide o design final, o aceite e a publicação.

## Limites e liberação

- Não inserir senhas, chaves ou dados de clientes no briefing. O filtro de credenciais não substitui a revisão humana.
- Criação de repositório, branch de trabalho e despacho autônomo ao Codex continuam externos. A integração por comentário retornou exigência de ambiente Legacy mesmo após publicação do novo ambiente; não contornar permissões ou inventar recibos.
- Perfis Factory são locais e integram backup cifrado. Rascunhos não sobrevivem ao encerramento do app.
- Nenhum merge ou publicação de produção sem aceite final. Teste real no iPhone e auditoria autenticada ainda necessários. A prévia Expo Go não é uma build nativa assinada.
- Rollback: manter os manifests e links de prévias anteriores; reverter o código do gateway sandbox ao SHA validado anterior, sem restaurar ou apagar dados por padrão.
