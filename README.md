# Inteligência Pessoal Evolutiva

Base funcional 1.0 de uso individual. O nome da personagem fica em aberto. A personalidade original usa investigação, questionamento e humor leve. O aplicativo usa React Native, Expo, TypeScript e SQLite. O gateway usa Python e SQLite. Supabase fica fora desta versão porque o uso individual e as memórias restritas ao aparelho dispensam uma conta e um banco em nuvem.

## O que funciona

- **Conversa.** Fila persistente com confirmação por mensagem. O aplicativo permite escolher Ollama ou OpenAI, continuar uma conversa com o contexto anterior e incluir uma memória marcada como disponível. O contexto escolhido aparece antes do envio.
- **Memória.** Oito categorias com criação, busca, correção e exclusão. A marcação privada impede a inclusão por atalhos de sugestões e de conversa. Uma alteração ou exclusão usando versão antiga é recusada. O app não espelha o banco no servidor.
- **Iniciativa.** Com permissão prévia e revogável, o app seleciona uma ideia não privada arquivada há pelo menos sete dias. A avaliação roda na abertura, no retorno ao primeiro plano e ao atualizar os dados. Cada sugestão pode ser dispensada. A regra usa data e categoria da memória, sem consultar a internet.
- **Laboratório.** A busca v1 é comparada com uma candidata que normaliza acentos e aceita termos fora de ordem. A bateria determinística usa seis casos e registra resultados, duração e divergências. O usuário autoriza a ativação. Uma nova execução verifica a candidata antes da troca. A busca pode voltar para v1.
- **Voz e personagem.** A aparência tem três cores e expressões para escuta e processamento. O ditado solicita reconhecimento local quando o aparelho e o idioma o suportam. A voz de saída usa a síntese de fala do sistema. Se a fala local estiver indisponível, use texto ou o ditado do teclado sob as configurações do aparelho.
- **Auditoria.** Ações locais geram eventos sem copiar o conteúdo da memória para o log. O gateway registra identificador, estado, mês e reserva da chamada. O token do proprietário fica no SecureStore. As chaves de provedores ficam no servidor.

## Usar apenas com o celular

1. Abra um repositório **privado** por um navegador móvel e importe os arquivos. Abra um terminal de desenvolvimento na nuvem a partir do navegador, se tiver acesso a um ambiente com Node.js 22+.
2. Em `mobile/`, execute `npm ci` e `npm run check`. Confirme as cotas e os requisitos do serviço de build antes de iniciar qualquer operação externa.
3. Para gerar um APK instalável no Android, configure um projeto Expo próprio e execute `npx eas-cli login`, `npx eas-cli build:configure` e `npx eas-cli build --platform android --profile preview`. Abra o link privado de distribuição no telefone. Se a build exceder a cota gratuita disponível, interrompa antes de contratar.
4. No iOS, use um app de desenvolvimento compatível ou uma build EAS com assinatura e distribuição autorizadas. Distribuição via TestFlight tem requisitos de conta Apple. Em teste sem módulos nativos personalizados, o Expo Go precisa ser compatível com o SDK 54 e o ditado integrado pode ficar indisponível. Para distribuição em loja, valide o identificador, configure a assinatura, confira as declarações de privacidade e use o perfil `production` somente após teste em dispositivos reais.
5. Na primeira abertura, experimente **Memórias** e **Laboratório**. O gateway é necessário para respostas generativas. Configure-o em **Ajustes** quando houver um host HTTPS. O computador pode ser substituído por um terminal hospedado, mas o servidor e o processo de assinatura ainda precisam existir.

## Gateway

Python 3.12+, SQLite e dados de fuso horário do sistema. Para teste local:

```sh
cd server
export OWNER_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
python main.py
```

Use o valor de `OWNER_TOKEN` escolhido por você na tela Ajustes. Guarde os segredos no gerenciador do host. A API HTTP do exemplo fica em loopback. Para acesso móvel, use proxy HTTPS e mantenha a porta Python fora da internet direta. Configure limite de conexões, timeout, volume persistente para `IPE_DB` e backup protegido. Use uma única instância com volume persistente. O Dockerfile permite hospedar a API em um serviço de contêiner autorizado. Um gateway iniciado sem provedores habilitados oferece status e auditoria, mas não gera respostas.

**Ollama.** Instale no mesmo host, execute `ollama pull qwen2.5:3b` e mantenha o serviço em loopback. Configure `OLLAMA_URL=http://127.0.0.1:11434` e, se necessário, `OLLAMA_MODEL`. Em contêineres, gateway e Ollama precisam dividir a rede de loopback. O modelo roda no host. A execução consome recursos dessa máquina, mesmo sem tarifa de API.

**OpenAI.** Só habilite após autorização explícita e com `ENABLE_PAID=yes`, `OPENAI_API_KEY` e `OPENAI_MAX_CALL_CENTS`. O gateway usa `gpt-4.1-mini` com até 650 tokens de saída e texto limitado a 6.000 caracteres. Configure a reserva em centavos como teto conservador por chamada, usando os preços vigentes de entrada e saída, câmbio, tributos e margem. Para um teto deliberadamente conservador, estime a entrada usando pelo menos 24.000 tokens possíveis para o texto UTF‑8 mais 1.000 de margem para o prompt de sistema e metadados. A configuração deve ser revisada quando preços ou câmbio mudarem. Use uma chave exclusiva e acompanhe a fatura diretamente no provedor.

`MONTHLY_LIMIT_CENTS` vale 2000 por padrão. As reservas são gravadas atomicamente antes de enviar, acumuladas no mês de São Paulo e mantidas mesmo após resposta incerta. Novas chamadas que ultrapassariam o limite de reservas são recusadas. Esse orçamento mede reservas conservadoras e depende do valor configurado. A fatura do provedor pode incluir diferenças de tarifa, câmbio e outras chamadas fora deste gateway.

| Operação | Finalidade |
| --- | --- |
| GET /status | Provedores, reservas mensais e tokens informados pela OpenAI |
| GET /audit | Até 50 chamadas recentes e seus estados |
| POST /chat | Recebe `id` UUID, `route` local ou paid, e `prompt` |

## Offline, recuperação e limites

Memórias e laboratório funcionam sem internet. Uma mensagem pode ser preparada e guardada para envio posterior se o gateway já estiver configurado. Reconectar não dispara chamadas. Se o resultado for incerto, consulte a auditoria e, se necessário, recoloque a mensagem na fila. O servidor deduplica o mesmo identificador mesmo após reinício. Se a resposta se perdeu após o provedor processar a chamada, esta versão não recupera o texto remoto.

O banco depende da proteção do sistema e pode estar sujeito às políticas de backup do aparelho. Marcar como privada limita o uso pelo app, não cifra uma memória individual. Excluir uma memória não apaga texto que você já tenha copiado para uma conversa, enviado a um provedor ou mantido em um backup. Exclua também a conversa associada quando necessário.

As memórias ficam em um único aparelho. O controle de versão impede sobrescrita local, mas a versão atual não inclui sincronização de memórias entre dispositivos. A fila sincroniza pedidos com o gateway usando deduplicação. A versão inicial também não inclui modelo no próprio celular, pesquisa web autônoma, notificações em segundo plano, geração de código para habilidades ou treinamento dos pesos do modelo. Para modelos no aparelho, teste primeiro RAM, espaço, latência e consumo em aparelhos-alvo. iOS e Android têm limites diferentes, e a alternativa funcional aqui é Ollama em um host autorizado.

O laboratório executa funções fixas e não aceita scripts escritos pelo modelo. A resposta do provedor é exibida como texto. O servidor não oferece ferramentas para ações externas, permissões, pagamentos ou alterações críticas. Para evolução supervisionada, novas versões de habilidades são introduzidas em código, avaliadas e então ativadas por decisão humana. O sistema atual não gera nem implanta essas versões sozinho.

## Verificação

```sh
cd server
python -m unittest -v
cd ../mobile
npm ci
npm run check
npm test
npx expo export --platform all
```

A integração HTTP do gateway é exercitada de verdade com adaptadores de teste. A suíte cobre autenticação, auditoria, recusa por orçamento sob concorrência, deduplicação após reinício e desativação de chamadas pagas. Os testes TypeScript cobrem a busca, os critérios da candidata e a validação de URL. Os bundles iOS e Android verificam o empacotamento JavaScript. Os testes em dispositivos e com respostas reais de modelos dependem de builds assinadas, aparelho e host configurados.
