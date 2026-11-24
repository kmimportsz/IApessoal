# NEXUS Factory | Perfil e briefing por projeto

## Regra permanente

Cada projeto deve manter um briefing versionado no seu próprio repositório, preferencialmente em `docs/PROJECT_BRIEF.md`. Não reutilizar identidade de outro projeto automaticamente.

## Modelo reutilizável

- Nome e objetivo:
- Público e problema real:
- Identidade visual: cores, tipografia, proporções, referências e componentes.
- Preferências de navegação e experiência:
- Tecnologias e arquitetura existentes:
- Dados e funções que devem ser preservados:
- Restrições, orçamento e permissões:
- Critérios verificáveis de aceite:
- Pedido atual e escopo:
- Contribuição comprovada de cada IA:
- Testes, resultados, riscos restantes e rollback:

Antes de modificar um projeto existente, leia o briefing vigente e o código correspondente. Quando uma preferência não estiver registrada, não invente: preserve o que existe e declare a hipótese. Alterações de identidade precisam de autorização. Não registre segredos ou dados de clientes no briefing.

## Regras comuns

Prioridade ao cliente, simplicidade de navegação, responsividade, acessibilidade, eficiência operacional e sustentabilidade financeira. Relatórios curtos com evidências. ChatGPT planeja e pode implementar; Codex implementa ou revisa de forma verificável; Diretora audita; fundador aprova. A geração do prompt não representa despacho automático para os agentes.

## Estado da primeira entrega

Perfis locais por projeto no aparelho; briefing gerado deterministicamente, copiável e compartilhável. Persistência SQLite aditiva, sem sincronização automática. O arquivo por projeto deve ser atualizado explicitamente por um agente autorizado. Ainda não é um executor autônomo.
