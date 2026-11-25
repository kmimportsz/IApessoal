# Evolução máxima — programa de qualidade da IA Pessoal

NEXUS-MISSION: 2177d36b-02d8-4cbb-88b0-88d1e401bc42

A candidata integrada (PR #15, SHA 993a5f0c6191c95feab63b325bf81e95d7920dda) é a referência preservada. A evolução deve ser medida contra ela, não por quantidade de funções, promessas ou notas inventadas. A versão máxima é um programa contínuo com marcos de aceite; não significa treinar pesos, obter acesso irrestrito ou superar o limite dos modelos por instrução de sistema.

| Pilar | Entrega desta candidata | Próximo marco verificável |
| --- | --- | --- |
| Metacognição | Revisão explícita, risco e evidência como sinais distintos; roteamento da reconsideração para modelo avançado, sem segunda chamada | Comparar respostas reais e correções em conjunto sintético e casos inéditos; calibrar confiança e oferecer verificação adicional somente com orçamento autorizado |
| Memória | Abstenção diante de conflito entre categorias temporais, revisões inválidas e datas futuras | Memória local com proveniência, isolamento explícito por projeto, proposta revisável de aprendizado e teste de correção/revogação; não treinar automaticamente |
| Iniciativa | Deduplicação de ação por projeto, com data válida | Descobertas verificáveis em fontes autorizadas, registro de feedback, controle de frequência e teste real de notificações e revogação |
| NEXUS | Confere ID e avanço da versão entre sincronização e auditoria | Completar o ciclo real via executor oficialmente suportado, com recibos de execução, CI por SHA, teto de iterações e aceite humano; bloqueio Legacy segue externo |
| Laboratório | 10 casos sintéticos, 30 critérios humanos, avaliação A/B cega, bloqueio por regressão ou falha crítica | Executar comparação real controlada em sandbox, com entradas inéditas, custo, latência, repetição e revisão independente; nenhuma pontuação de modelo é produzida por fixtures |

## Qualidade global
Antes de promover: CI completo, revisão independente no SHA atual, teste real iPhone e de acessibilidade, auditoria autenticada, restauração de backup em ambiente isolado, testes de revogação e orçamento, verificação de filas e recuperação, comparação de latência e consumo, evidência de que não houve perda de funções. Não fazer merge, publicar, alterar credenciais, banco, identidade ou cotas sem aceite explícito. O repositório é público: nunca gravar dados pessoais, memórias ou credenciais em fixtures, avaliações ou logs.

## Laboratório comparativo
Execute `node scripts/intelligence-benchmark.mjs prepare` para gerar a lista de casos sintéticos. Em sandbox autorizado, registre duas séries de respostas reais com os mesmos prompts, modelo/ajustes comparáveis e SHA da implementação. Randomize os rótulos A/B e mantenha a atribuição fora da visão do avaliador. Avalie cada critério booleano com as respostas à mão, registre as justificativas e conserve as evidências privadamente; não use as respostas esperadas como prompt. Prepare um JSON com:
- `version`: "ipe-quality-1"; `assignment`: {"baseline":"A","candidate":"B"} (ou inverso).
- `baseline` e `candidate`: objetos com sha de 40 hex, model, runId distinto e durationMs total.
- `grades`: lista completa de {id,A:[boolean,boolean,boolean],B:[boolean,boolean,boolean]}.
Execute `node scripts/intelligence-benchmark.mjs compare avaliacao.json`. O relatório calcula critérios, regressões e falhas críticas. O motor valida o formato, não autentica os recibos nem a veracidade das avaliações; uma planilha preenchida não equivale a CI ou aprovação. A condição de avanço exige ganho e zero regressão/falha crítica na candidata. Empate não demonstra evolução.

## Limites atuais
Não há inferências extras, aprendizagem de pesos, novo acesso a fontes, alteração de permissões, gastos, implantação ou automação autônoma nova nesta candidata. A comparação real de modelos, a build nativa, o fluxo completo de Codex e os testes no dispositivo continuam dependentes das integrações e da autorização já previstas. Rollback: descartar a candidata isolada, mantendo o SHA do PR #15 e dados intactos.

## Segunda etapa — execução e aprendizado assistido
- Chat: botão Reavaliar prepara novo pedido crítico sem enviar automaticamente; preserva o contexto e verifica memória original, sem sobrescrever rascunho.
- Aprendizado: declarações explícitas de preferências, decisões, objetivos, erros e lições geram rascunhos privados editáveis. Novas permissões automáticas são restritas à conversa selecionada e verificadas novamente pela fila. Permissões globais antigas são preservadas até revogação. A migração é aditiva e backups não transportam autorizações automáticas.
- Prioridades: a central usa apenas projetos e repositórios ativos, com permissões atuais carregadas. Não cria ações externas.
- NEXUS: alteração do estado da revisão Codex ou do CI no mesmo commit invalida o relatório anterior.
- Benchmark: o executor usa o gateway real de sandbox, um caso por autorização, com recibo recuperável. A execução permanece pendente até haver um sandbox autorizado e credenciais locais, sem compartilhá-las no GitHub.

### Executar casos reais
Use Node 22+, um sandbox autorizado do projeto e uma pasta de resultados privada, fora do repositório. Configure localmente `IPE_BENCHMARK_URL`, `IPE_BENCHMARK_TOKEN` e `IPE_BENCHMARK_AUTHORIZED=yes`. Confirme que o gateway corresponde ao SHA declarado e que a cota de prévia é 6 chamadas/950 neurons. Não use produção nem faça commits com resultados pessoais.

```sh
node scripts/run-intelligence-case.mjs start /caminho/privado/caso.json correction SHA_DE_40_CARACTERES
node scripts/run-intelligence-case.mjs recover /caminho/privado/caso.json
```

O primeiro comando grava o ID antes de enviar; o segundo apenas consulta o mesmo ID. Não reenvie em caso de falha incerta. A comparação de 10 casos em duas versões exige múltiplas janelas de cota; não elevar limites nem criar contas para contorná-los. O SHA declarado pelo operador não é uma atestação criptográfica do deploy.

## Terceira etapa — validação e entrega rastreável
- A execução 45523815216 (PR #17, cabeça f63ffebe6ff3f35ca1405c086af9f3b7ffbd5153) concluiu os três jobs: gateway, TypeScript/testes Expo e empacotamento. Os logs registraram bundles iOS (2.412.441 bytes) e Android (2.425.585 bytes). A revisão de código do Codex nesse SHA não indicou apontamentos. A revisão de segurança ainda não estava confirmada.
- A candidata seguinte separa o recibo de revisão de segurança do recibo de revisão de código. Achados não resolvidos ou revisão de segurança atual em andamento bloqueiam o aceite. Ausência de recibo é explicitamente informada, nunca interpretada como revisão aprovada.
- A exportação Expo passa a conservar artefato temporário com manifesto SHA-256 e distinção entre SHA do checkout e cabeça do PR. Não é uma build assinada nem uma prévia publicada.
- O teste de integração do laboratório usa o gateway autenticado local, fila e recuperação de recibo com provedor simulado. Não é avaliação de inteligência do modelo real.

Acesso Cloudflare: não alterar permissões, credenciais ou serviços para contornar falhas de conexão do plugin. A comparação real e a auditoria na instalação autorizada permanecem bloqueadas enquanto o acesso operacional não estiver confirmado. A publicação em produção e o teste físico final não estão autorizados nesta etapa.
