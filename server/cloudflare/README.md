# Gateway HTTPS da IA Pessoal 1.1

O app já entende as rotas autenticadas `GET /status`, `GET /audit` e `POST /chat`. Este Worker usa o mesmo formato da rota `local`, chamada **Ollama** no seletor da versão 1.1. Quando o app aponta para este gateway, a rota vai para o modelo indicado pelo servidor. O gateway Python continua disponível para Ollama, llama.cpp em loopback e integrações futuras.

## Arquitetura escolhida

Workers Free, Workers AI com Qwen3-30B-A3B-FP8 e D1 para deduplicação e auditoria. A cota gratuita de inferência é compartilhada pela conta (10.000 Neurons/dia). Este gateway limita o uso a oito tentativas por dia UTC, conserva os envios incertos na contagem e desativa a rota paga. Se a cota de qualquer serviço gratuito for atingida, novas chamadas param. O limite monetário informado ao app continua em R$ 20, com R$ 0 autorizados para chamadas pagas neste gateway.

O binding Workers AI executa a inferência sem chave de API no app. D1 persiste apenas ID, horário e estado das chamadas e o hash da credencial do proprietário. As mensagens e memórias ficam no SQLite do aparelho. O provedor recebe o texto confirmado para inferência, incluindo contexto escolhido pelo usuário. O guia não pressupõe que a política de retenção do provedor seja equivalente ao armazenamento local.

| Alternativa | Quando serve | Dependências |
| --- | --- | --- |
| Workers AI + D1 | Uso pessoal contínuo com HTTPS e persistência | Conta Workers Free confirmada e acesso de escrita do integrador aos Workers e ao D1 |
| Groq Free + host HTTPS gratuito | Alternativa para GPT-OSS 120B | Conta e chave Groq exclusivamente no servidor. A hospedagem Render Free tem suspensão por ociosidade e disco efêmero, por isso exige armazenamento durável adicional |
| Ollama ou llama.cpp no próprio host | Inferência sem tarifa de API | Máquina ligada com memória suficiente e um endpoint HTTPS alcançável pelo iPhone |
| API cobrada por consumo | Alternativa futura sob autorização expressa | Chave no servidor, controles contratuais de cobrança e revisão do teto antes da ativação |

Fontes oficiais: [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Qwen3](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [Groq](https://console.groq.com/docs/rate-limits), [Render](https://render.com/docs/free).

## Configuração do operador

1. Confirme **Workers Free na mesma conta** onde o Worker e D1 serão criados. A flag abaixo é uma declaração do operador. Ela não consulta a assinatura. Se o plano mudar, pause o serviço e revise os limites antes de reativá-lo.
2. Aplique `schema.sql` a um banco D1. Faça deploy de `worker.mjs`, `persona.mjs` e `setup.mjs` como módulos, com os bindings `DB` (D1) e `AI` (Workers AI). Configure `DEPLOYMENT_TIER=workers-free-confirmed`. O Worker só aceita modelos registrados em código. Para trocar de modelo, adicione e teste um adaptador e configure `MODEL` no servidor.
3. Gere um código aleatório descartável e configure seu SHA-256 em `PAIR_SHA256`. Configure `PAIR_UNTIL` como timestamp de expiração em milissegundos. O endereço de configuração usa `/setup#<código>`. O fragmento só é lido na página e o código é enviado no corpo do POST após o toque do usuário. A troca cria uma credencial aleatória, mostra-a uma vez e grava só seu hash no D1. Desative o pareamento após a configuração. Para revogar acesso, remova a credencial registrada e faça um novo pareamento.
4. Para o teste inicial, `OWNER_SHA256` pode conter temporariamente o hash de uma credencial de operação. Use-a antes do pareamento; a credencial registrada pelo usuário toma precedência. Remova o segredo temporário após o teste.
5. No iPhone, abra **Ajustes → Gateway de modelos**. Preencha o endereço HTTPS e a credencial local mostrada na página de configuração. Salve, abra **Conversa**, escolha a rota **Ollama**, digite uma mensagem descartável e confirme **Enviar**. A validação termina quando o balão de resposta chega ao aparelho. Confira o ID e o estado `finished` na auditoria.

## Verificação local

```sh
node --test server/cloudflare/*.test.mjs
cd server
python -m unittest -v
```

Para provar a inferência sem conta de serviços, execute llama.cpp com um GGUF compatível em `127.0.0.1:18111` e use `LOCAL_BACKEND=llama.cpp`, `LLAMA_CPP_URL=http://127.0.0.1:18111` e `OLLAMA_MODEL` como o alias do modelo. Esse modo é adequado a uma validação em loopback. A sessão de desenvolvimento não é hospedagem do iPhone. Defina o token do proprietário com pelo menos 32 caracteres. Chaves de serviços e credenciais ficam fora do repositório.
