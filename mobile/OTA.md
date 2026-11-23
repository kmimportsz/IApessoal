# Atualizações OTA da IA Pessoal 1.5

A versão do aplicativo permanece em **1.5.0**. A build própria mantém o ícone da IA Pessoal e o identificador `app.ipe.personal` no iOS e Android. Este projeto usa Expo SDK 58, React Native 0.88 e Expo Updates da matriz oficial do SDK.

| Perfil EAS | Canal | Uso |
| --- | --- | --- |
| `development` | `development` | Desenvolvimento nativo com Dev Client. Android gera APK. |
| `development-simulator` | `development` | Dev Client de iOS para simulador em Mac. |
| `preview` | `testing` | Build interna em modo release. Validação de OTA em aparelho. Android gera APK. |
| `production` | `production` | Distribuição final com atualizações aprovadas. |

## Vincular e preparar os instaladores

Um administrador do projeto Expo executa em `mobile/`:

```sh
npm ci
npx eas-cli@27.11.0 login
npx eas-cli@27.11.0 init
```

Confirme o proprietário e o projeto antes de vincular. Se a CLI pedir edição manual por causa de `app.config.js`, adicione o UUID retornado em `expo.extra.eas.projectId` no `app.json`. Esse UUID é público. Mantenha as credenciais no EAS ou no gerenciador seguro da equipe. O arquivo dinâmico deriva o endpoint HTTPS `https://u.expo.dev/<UUID>`, usa a política `fingerprint` e desativa a consulta nativa ao lançar porque o aplicativo coordena as verificações. Uma build EAS falha se o projeto estiver sem vínculo.

Crie os canais uma vez no projeto, se ainda não existirem. Se existirem, confirme para quais branches EAS apontam:

```sh
npx eas-cli@27.11.0 channel:create development
npx eas-cli@27.11.0 channel:create testing
npx eas-cli@27.11.0 channel:create production
```

Para Android, a rota inicial é o APK interno, sem conta Play Console. Use apenas a cota gratuita disponível do EAS. Para gerar a build destinada a validar OTA, use `preview`. Para depuração nativa, use `development`. O Dev Client executa o aplicativo por meio de um servidor de desenvolvimento ou seleciona uma atualização pelo launcher. Para validar a verificação automática e o reinício da build distribuída, instale a build release `preview`.

```sh
npx eas-cli@27.11.0 build --platform android --profile development
npx eas-cli@27.11.0 build --platform android --profile preview
```

Para instalar em um iPhone físico por distribuição interna, é necessária uma equipe ativa do **Apple Developer Program**, com permissão para gerenciar assinatura e provisionamento ad hoc. Execute `npx eas-cli@27.11.0 device:create` e abra no iPhone o link de registro oferecido pelo EAS. Conclua o registro do aparelho para incluir seu UDID no perfil. Depois, gere a build:

```sh
npx eas-cli@27.11.0 build --platform ios --profile development
npx eas-cli@27.11.0 build --platform ios --profile preview
```

Instale pelo link do EAS. Se o iPhone pedir Modo Desenvolvedor para o Dev Client, siga a instrução do iOS. O perfil de simulador pode ser compilado sem assinar para um aparelho e roda apenas em simulador. Para TestFlight ou App Store, a equipe Apple também deve ter acesso ao App Store Connect. A assinatura Apple dos instaladores é independente da assinatura criptográfica de bundles OTA.

## Dados e primeira instalação

Atualizações OTA dentro da mesma instalação trocam o bundle. O SQLite continua em `ipe.db` e a credencial continua no SecureStore sob `gatewayCredentials`. O código OTA grava apenas o horário da última consulta em `options`. Versões nativas posteriores devem conservar o identificador, a assinatura compatível e o armazenamento, e usar migrações aditivas, idempotentes e compatíveis com a estratégia de rollback.

O Expo Go mantém o banco e o SecureStore em seu próprio contêiner. Antes de instalar o app próprio, mantenha o Expo Go e use **Ajustes → Backup integrado → Gerar cópia cifrada** para transferir os dados suportados. Guarde a chave separadamente, restaure na build própria e configure nela a credencial do gateway. O backup atual transfere memórias, histórico de conversa e preferências selecionadas. Projetos do gateway continuam acessíveis com a mesma credencial. O backup não reproduz fielmente a fila pendente, consentimentos temporários nem arquivos de avatar. Resolva os envios pendentes no Expo Go e mantenha a instalação original para acesso ao histórico completo.

## Fluxo de publicação

1. Verifique o plano e a cota no painel Expo. Use apenas quantidades cobertas pelo plano autorizado. Rode `npm ci`, `npm run check` e `npm test` em `mobile/`.
2. Compare o fingerprint por plataforma com as builds instaladas que você pretende atualizar. Use a listagem de builds no EAS, os detalhes do grupo e `npx eas-cli@27.11.0 fingerprint:generate --platform ios --environment preview` ou a variante Android, com o mesmo código e ambiente usados para empacotar. SDK, dependências nativas, permissões, plugins nativos, entitlements, identificador e política de runtime podem mudar o fingerprint. Quando houver divergência, gere nova build para a plataforma afetada. Não fixe um valor de runtime para forçar compatibilidade.
3. Publique o candidato em `testing` com `npx eas-cli@27.11.0 update --channel testing --environment preview --message "IA Pessoal 1.5: descrição da mudança"`. Guarde o ID do grupo.
4. Nas builds release instaladas em iOS e Android, verifique o canal e o runtime em **Ajustes**. Crie dados fictícios e valide verificação ao iniciar e ao voltar do segundo plano, download, tentativa de reinício durante envio e com rascunho, aplicação quando o app estiver livre, reinício offline e persistência de conversas, memória, projetos, configurações e acesso ao gateway.
5. Promova exatamente o grupo validado com `npx eas-cli@27.11.0 update:republish --group ID_VERIFICADO --destination-channel production`. Confirme o grupo, as plataformas e os fingerprints no painel. Para testar no canal de desenvolvimento, use `update --channel development --environment development` com uma descrição. Mantenha as branches dos canais separadas.

O aplicativo consulta no lançamento e ao ficar ativo, com intervalo persistente de 15 minutos. Ao encontrar uma atualização, exibe um aviso. O download usa o cliente nativo de atualizações via HTTPS e começa após confirmação. O botão de reinício aguarda operações locais e envios ativos e protege rascunhos detectáveis. Mensagens já gravadas na fila continuam disponíveis pela recuperação existente; a atualização não reenvia solicitações. Se a pessoa encerrar e reabrir o app após baixar uma atualização, o carregador nativo pode usar o bundle já baixado nessa abertura.

## Falhas e recuperação

- Falhas de consulta deixam a versão atual em uso e respeitam o intervalo. Falhas de download e de reinício exibem uma mensagem e permitem nova tentativa.
- A build inclui um bundle de recuperação. O Expo Updates pode recorrer a um bundle anterior ou embutido quando detecta falhas de lançamento, conforme o estado de inicialização.
- Se uma publicação causar regressão, republique no canal afetado o último grupo saudável do mesmo runtime. Valide a recuperação em `testing` primeiro. Se a correção depender de código nativo, distribua nova build. Não instrua o usuário a desinstalar para recuperar.
- O transporte usa HTTPS para o serviço EAS. A assinatura de bundles por certificado próprio do EAS Update exige um plano Production ou Enterprise. Ela não está ativada. Se for autorizada futuramente, distribua uma build com o certificado público e mantenha a chave privada só no ambiente seguro de publicação.

[Compatibilidade de runtime](https://docs.expo.dev/eas-update/runtime-versions/) · [Distribuição interna e registro de dispositivos](https://docs.expo.dev/build/internal-distribution/) · [Recuperação](https://docs.expo.dev/eas-update/error-recovery/) · [Assinatura OTA](https://docs.expo.dev/eas-update/code-signing/) · [Planos Expo](https://expo.dev/pricing)
