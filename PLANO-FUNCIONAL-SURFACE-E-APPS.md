# OrdaX — plano funcional da Surface e dos aplicativos principais

**Status:** proposta detalhada de produto e roteiro de implementação; não altera contratos canônicos nem declara funcionalidades concluídas.

**Data:** 18/09/2026. **Base inspecionada:** `origin/main`, commit `4f1ea27d052ca75ff32807f3ee7578a3059b7707`, do repositório `washingtonmsdj/prototipo-ordax-os`.

**Escopo:** área de trabalho e os quatro aplicativos da barra lateral: **Arquivos, Ajustes, Conta e Sistema**, incluindo suas subseções e estados. Este arquivo deve poder ser entregue a outro GPT para orientar implementação real, incremental e verificável.

**Como interpretar:** “deve” expressa o comportamento proposto para a funcionalidade quando implementada. Não significa que o recurso já existe. As marcas de estado e prioridade diferenciam implementação observada, lacuna e evolução futura. Revalidar a `main` antes de executar, pois o repositório está evoluindo rapidamente.

**Continuação:** [Parte 2 — evolução do protótipo e aproveitamento seletivo do legado](PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md) compara este projeto com `novo-ordax-os`, separa funcionalidades concretas de ideias futuras e detalha o que ainda falta adicionar. Leia as duas partes antes de ampliar o produto; a parte 2 também registra avanços do protótipo posteriores ao inventário acima.

## Sumário

1. [Objetivo e limites](#1-objetivo-e-limites)
2. [Estado observado no remoto](#2-estado-observado-no-remoto)
3. [Organização e responsabilidade única](#3-organização-e-responsabilidade-única)
4. [Regras comuns de interface e comportamento](#4-regras-comuns-de-interface-e-comportamento)
5. [Área de trabalho e barra lateral](#5-área-de-trabalho-e-barra-lateral)
6. [Arquivos: telas e operações](#6-arquivos-telas-e-operações)
7. [Ajustes: telas e preferências](#7-ajustes-telas-e-preferências)
8. [Conta: identidade e continuidade](#8-conta-identidade-e-continuidade)
9. [Sistema: estado e manutenção](#9-sistema-estado-e-manutenção)
10. [Contratos, dados e integração](#10-contratos-dados-e-integração)
11. [Diferenças entre modos](#11-diferenças-entre-modos)
12. [Lacunas e ordem de implementação](#12-lacunas-e-ordem-de-implementação)
13. [Verificação e critérios de entrega](#13-verificação-e-critérios-de-entrega)
14. [Instrução pronta para o GPT implementador](#14-instrução-pronta-para-o-gpt-implementador)
15. [Referências e decisões pendentes](#15-referências-e-decisões-pendentes)

## 1. Objetivo e limites

### 1.1 Resultado esperado

Transformar a identidade visual já adotada pelo OrdaX em uma experiência funcional coerente. O usuário deve conseguir localizar seus arquivos, ajustar sua experiência, entender sua conta e manter o sistema sem encontrar funções repetidas ou controles fictícios.

Cada tela precisa responder:

1. Onde estou e qual é o objetivo desta seção?
2. Quais dados são reais e de quando são?
3. O que posso fazer neste ambiente?
4. O que aconteceu depois da minha ação?
5. Se algo falhou, como continuar sem perder dados?

O objetivo desta etapa é completar os quatro aplicativos existentes. Loja de aplicativos, navegador, editor completo, assistente de IA, colaboração, pagamento e gerenciamento remoto genérico não entram implicitamente no escopo.

### 1.2 Relação com as imagens conceituais

As imagens servem como referência de linguagem visual, não como especificação literal ou evidência de capacidade. Alguns elementos das imagens precisam ser corrigidos:

- **Atualizações pertence apenas a Sistema.** Remover a seção de Ajustes.
- **Armazenamento pertence a Sistema.** Arquivos pode apresentar um resumo e um atalho para essa tela.
- **Sobre pertence a Sistema.** Não criar uma segunda página Sobre em Ajustes.
- **Rede e periféricos ficam em Ajustes.** Sistema pode resumir a conectividade e encaminhar para Ajustes.
- **Dispositivos da conta** significa sessões vinculadas à identidade; não significa mouse, teclado ou impressora.
- Tema Automático, seleção de papel de parede, cores alternativas, edição de perfil e autenticação em duas etapas eram sugestões visuais, não funcionalidades demonstradas.
- “Seu nome”, dados de exemplo e botões sem backend não devem aparecer como estado real no produto.
- O conceito de cores alternativas fica para evolução posterior: a identidade vigente define o laranja como destaque principal.

### 1.3 Restrições que continuam valendo

- Uma fonte compartilhada em `system/`; diferenças de ambiente em adapters.
- Consumir capacidades reais; a presença de uma capacidade em documento de arquitetura não prova que o adapter a implementa.
- Não introduzir dependência de Codex, SSH, WSL ou toolchain do usuário para operar o produto.
- Não transformar esta proposta de interface em autorização de formatação, instalação, escrita RAW ou promoção de release.
- Não copiar telas, CSS ou regras para versões separadas Web, Mobile, Desktop e Native.
- Não migrar partições ou alterar o bootstrap para entregar uma melhoria de navegação.
- Preservar a distinção entre desenvolvimento Git-first e release canônica assinada.
- Telemetria operacional existente não equivale a conta autenticada, sincronização de dados ou controle remoto.

### 1.4 Convenções de estado e prioridade

| Marca | Significado |
|---|---|
| EXISTE | Comportamento encontrado no source inspecionado; não implica teste físico nesta análise. |
| PARCIAL | Há contrato, parte do serviço ou fluxo limitado, mas falta completar a experiência. |
| NOVO | Não encontrado no fluxo inspecionado; precisa de implementação e validação. |
| FUTURO | Proposta que depende de infraestrutura ou decisão posterior. |
| P0 | Organização, correção e integração necessárias antes de ampliar recursos. |
| P1 | Funcionalidade básica para os quatro apps se tornarem úteis. |
| P2 | Recursos que exigem novos adapters, serviços ou infraestrutura. |
| P3 | Expansões de produto que podem esperar. |

As prioridades são de implementação, não de exposição: uma tela P2 não deve aparecer cheia de controles desabilitados na entrega P1. Durante desenvolvimento, pendências ficam neste plano; na interface, mostrar apenas o que ajuda o usuário naquele contexto.

## 2. Estado observado no remoto

### 2.1 Inventário funcional

| Área | Existe no source | Ainda falta em relação a este plano |
|---|---|---|
| Identidade visual | Documento `DESKTOP-IDENTITY.md`, canvas mineral, laranja, rail, composição geométrica, temas claro/escuro. | Refinar consistência, responsividade, acessibilidade e retirar textos de investigação da experiência normal. |
| Área de trabalho | Relógio/data, lançador com busca, quatro apps, atalhos para pastas, áreas e persistência do workspace. | Navegação uniforme por subseções, restauração de estado interno dos apps e testes de fluxo completos. |
| Arquivos | Adapter nativo delimitado, listar pastas/arquivos, abrir pastas, breadcrumbs, criar pasta, atualizar listagem. | Abrir conteúdo de arquivos, seleção, renomear, copiar/mover, importação/exportação, busca, favoritos e lixeira. |
| Ajustes | Catálogo de preferências com `appearance.theme`, valores `light`/`dark`, persistência e integração com núcleo local de sync. | Subseções e demais preferências; automático, wallpaper, acessibilidade e configurações de hardware não estão demonstrados. |
| Conta | Portas de sessão/ações, apresentação do estado de identidade, núcleo de sync, fila local e metadata de áreas/apps. | Provedor real de identidade, perfil editável, segurança da conta, registro/revogação de sessões e transporte autenticado. |
| Sistema | Visão geral, commit, estado de atualização, memória, espaço do usuário, tempo ligado e atualização de leitura. | Navegação por subseções, histórico completo, ações manuais por contratos, inventário detalhado e exportação de diagnóstico. |
| Energia | Controles nativos e confirmação de ações, com evidência anterior de reinício/desligamento no USB de desenvolvimento. | Unificar entradas na mesma implementação; suspensão/hibernação continuam dependentes de suporte e prova. |
| Atualização | Watcher nativo, status/fases, recarga, health acknowledgement, informações de rollback e painel no rodapé. | Central única de apresentação, comandos manuais explícitos quando disponíveis e histórico persistente consumível pela UI. |
| Diagnóstico | Contrato canônico, telemetria operacional e heartbeat de base/supervisor no source. | Tela local completa, leitura agregada por porta neutra, estado de atualidade e pacote revisável de diagnóstico. |
| Recuperação | Fluxos de bootstrap, rollback de desenvolvimento e rescue delimitado existentes. | UX local de recuperação, planos de ação e validação específica por perfil; não presumir recuperação canônica concluída. |

### 2.2 Limitações importantes encontradas no código

1. `system/contracts/file-space.mjs` evoluiu para `ordax.file-space/4`: além de `list()`, `createDirectory()`, `readTextFile()` e `renameEntry()`, o Native oferece `copyFile()` para arquivo regular na mesma pasta, com limite de 64 MiB, criação exclusiva do destino e limpeza de cópia parcial em falha. A visualização continua somente leitura, UTF-8 e limitada a 256 KB. Entradas continuam com `name`, `kind` e `size`; ainda não há data de modificação, cópia entre pastas/volumes, mover, excluir/lixeira ou abertura por associação de app.
2. A composição Web inspecionada não monta um adapter real de arquivos. A existência do app Arquivos não significa acesso ao disco no navegador.
3. `appearance.theme` é a única preferência no catálogo observado. Não implementar controles de preferências apenas com alterações de CSS sem registrá-las, validá-las e persistir seu estado.
4. `createWebIdentitySession()` retorna `unavailable`, e `createWebIdentityActions()` anuncia zero ações. A composição Native também usa essas portas de identidade. Portanto, não há login real demonstrado nesses caminhos.
5. O núcleo de sincronização e sua fila persistente já existem. Isso não prova que algo foi enviado para a nuvem ou que duas máquinas compartilham uma conta real.
6. `ordax.update-status/1` é uma porta de observação: `getSnapshot()` e `subscribe()`. O watcher possui confirmação de saúde para a composição, mas isso não é um comando de usuário “Verificar atualizações”.
7. `ordax.system-metrics/1` continua restrito a tempo ligado, memória total/disponível e capacidade total/livre do espaço do usuário; não há nesse contrato inventário de CPU/GPU, temperatura, volumes físicos ou categorias de armazenamento. O estado de bateria foi separado em `ordax.power-status/1`: leitura Native de percentual/estado de carga/energia externa a partir de `sysfs`, sem serial/modelo e com item de bandeja oculto quando não há bateria válida. O leitor aceita tanto `capacity` quanto pares `energy_*`/`charge_*`, evitando ocultar baterias válidas por diferença de driver. O suporte explícito de kernel ACPI/power-supply é tratado em entrega low-level separada, pois exige boot refresh.
8. O painel de atualizações no rodapé e a visão de Sistema repetem tradução de status e detalhes. A evolução deve compartilhar esse modelo e ter uma única tela completa.
9. O rótulo visível foi padronizado para **Ajustes** em rail, launcher, janela e extensão compartilhada, preservando o ID estável `settings`.
10. O estado `running` passou a ser apresentado como **Em execução**, sem afirmar “Atualizado”; estar executando normalmente não prova, sozinho, que nenhuma entrega mais nova apareceu após a última verificação.
11. Conectividade `online` não prova acesso ao serviço de conta, ao canal de atualização ou à internet inteira. Cada operação precisa relatar seu próprio resultado.
12. O snapshot `CURRENT-STATE.md` não resume necessariamente todos os commits posteriores. Para afirmar implementação, cruzar snapshot, contrato, composição e código do commit analisado.

### 2.3 O que esta análise verificou

Inspeção documental e de código remoto, sem executar esta versão no notebook e sem reexecutar CI. As referências a testes indicam cobertura existente ou verificação a executar, não resultado novo de teste. Nenhuma alteração no runtime é realizada por este documento.

## 3. Organização e responsabilidade única

### 3.1 Árvore completa proposta

Os itens condicionais aparecem somente quando há capacidade utilizável; FUTURO indica planejamento, não menu obrigatório na primeira entrega.

```text
Área de trabalho
├─ Relógio e data
├─ Lançador de aplicativos
├─ Atalhos pessoais
├─ Áreas de trabalho
└─ Estado resumido e menu de energia

Arquivos
├─ Meu espaço                         [entrada padrão]
├─ Recentes
├─ Favoritos
├─ Documentos
├─ Imagens
├─ Downloads
├─ Locais e unidades                  [condicional]
├─ Lixeira                            [quando houver backend]
└─ Resultados de busca / detalhes      [vistas contextuais]

Ajustes
├─ Aparência                          [entrada padrão]
├─ Acessibilidade
├─ Área de trabalho
├─ Idioma, data e hora
├─ Rede e conexões                    [condicional]
├─ Dispositivos e som                 [condicional]
└─ Notificações e permissões          [condicional]

Conta
├─ Visão geral                        [entrada padrão]
├─ Perfil                             [autenticação necessária]
├─ Segurança                          [provedor necessário]
├─ Dispositivos e sessões             [serviço necessário]
├─ Sincronização
└─ Dados e privacidade                [serviço necessário]

Sistema
├─ Visão geral                        [entrada padrão]
├─ Atualizações
│  └─ Histórico                       [detalhe da mesma seção]
├─ Armazenamento
├─ Diagnóstico
├─ Recuperação
├─ Energia                            [condicional]
└─ Sobre
```

### 3.2 Matriz de responsabilidade

| Assunto | Local único de gestão | Resumos/atalhos permitidos |
|---|---|---|
| Conteúdo e organização de arquivos pessoais | Arquivos | Pastas na área de trabalho; abrir pasta a partir de Sistema. |
| Capacidade, volumes e reserva para atualização | Sistema → Armazenamento | Espaço livre em Arquivos; alerta contextual em Atualizações. |
| Tema, fonte, movimento, wallpaper | Ajustes | Conta informa se a preferência participa do sync. |
| Estado/política de sincronização | Conta → Sincronização | Ajustes mostra “salvo localmente” ou estado confirmado da preferência. |
| Senha, passkeys, autenticação e sessões | Conta | Sistema não edita credenciais. |
| Rede, áudio e periféricos locais | Ajustes | Sistema mostra resumo de rede/hardware sem duplicar controles. |
| Atualizações e histórico | Sistema → Atualizações | Rodapé abre essa mesma subseção. |
| Versão do produto/componentes | Sistema → Sobre/Visão geral | A Surface pode resumir a versão humana; SHA/build permanece detalhe técnico. Componentes do mesmo bundle compartilham versão até existir empacotamento independente real. |
| Falhas, saúde, logs e exportação técnica | Sistema → Diagnóstico | Alertas dos apps abrem ocorrência correspondente. |
| Recuperação de sistema | Sistema → Recuperação | Atualizações aponta uma reversão já registrada. |
| Reiniciar/desligar e política de energia | Sistema → Energia | Menu do rail chama as mesmas ações e confirmações. |
| Versão, licenças, identidade da distribuição | Sistema → Sobre | Visão geral mostra um resumo. |
| Permissões locais de apps | Ajustes → Notificações e permissões | Conta administra somente dados e sessões da identidade. |

**Regra prática:** um resumo não é duplicação se não cria outro dono, política, armazenamento ou editor. O atalho deve abrir a tela canônica já existente, com o estado atual.

### 3.3 Modelo de navegação

- Manter IDs existentes: `files`, `settings`, `account`, `system`.
- A navegação interna deve ter IDs estáveis, por exemplo `overview`, `updates`, `storage`, `appearance` e `sync`; traduzir somente rótulos.
- Caminhos como `Sistema > Atualizações > Histórico` neste documento são caminhos de UX, não URLs ou APIs já implementadas.
- Primeiro acesso: Arquivos abre Meu espaço; Ajustes abre Aparência; Conta e Sistema abrem Visão geral.
- Reabrir um app pode restaurar sua última subseção válida. Um atalho explícito sempre vence essa restauração.
- Não abrir outra janela singleton só para visitar uma subseção. Focar/restaurar a janela existente conforme a política atual do workspace.
- Revalidar permissão ao restaurar. Se uma subseção deixou de existir, voltar à entrada padrão e explicar brevemente.
- Botão Voltar retorna ao contexto anterior dentro do app; não deve fechar o app nem saltar para outra área sem indicação.
- Busca global pode encontrar “tema”, “atualização” e “espaço livre” e abrir seus destinos canônicos. Busca em Arquivos pesquisa conteúdo autorizado; são escopos distintos.

## 4. Regras comuns de interface e comportamento

### 4.1 Estrutura de tela

**Regra de entrega e bandeja persistente:** a UI apresenta **Entrega N** como sequência humana do que é aplicável ao notebook, independente do número de PR; o SHA permanece a identidade técnica exata. Isso não é versão comercial do OrdaX e não deve ser repetido como se fosse versão própria de Surface, Arquivos, Ajustes, Conta, Sistema, Rede ou Atualizador. Números próprios de componente só aparecem quando existir empacotamento e ciclo de release independentes reais. Conectividade e horário são sinais essenciais do shell e permanecem visíveis em bandeja fixa. O clique em um sinal persistente deve preferir um **painel rápido contextual** quando houver ações/consulta cotidiana pequena (por exemplo Wi‑Fi, bateria e data/hora); Ajustes continua responsável pelas configurações completas e avançadas. Bateria só participa quando `ordax.power-status/1` detecta hardware válido.

Cada app usa um cabeçalho com nome, uma navegação interna quando necessária, uma região de conteúdo e uma área discreta de feedback. Não reproduzir o título gigante do conceito em toda janela pequena. Título e espaçamento precisam funcionar em uma janela normal, maximizada e em celular.

A linguagem vigente está em `DESKTOP-IDENTITY.md`: fundo mineral, texto preto/grafite, laranja de destaque, tipografia editorial para identidade e sans-serif para controles. Usar tokens semânticos. Claro e escuro são duas apresentações da mesma interface.

### 4.2 Estados obrigatórios

| Estado | Apresentação e comportamento |
|---|---|
| Inicial/carregando | Texto curto ou skeleton, `aria-busy`; não exibir métricas inventadas. |
| Pronto | Conteúdo real, ações disponíveis e seleção evidente. |
| Vazio | Explicar por que está vazio e oferecer a próxima ação aplicável. |
| Sem capacidade | Informar o limite do ambiente; não sugerir que o usuário concedeu uma permissão negada quando a API nem existe. |
| Permissão necessária | Explicar recurso e escopo antes de pedir autorização pelo host. |
| Permissão negada | Manter o contexto e oferecer caminho de reautorização quando existir. |
| Offline | Manter dados locais; distinguir “sem rede” de “serviço indisponível”. |
| Dados antigos | Preservar a última leitura com horário e indicação de que não foi atualizada. |
| Salvando/executando | Bloquear duplicação da mesma operação; continuar permitindo navegação segura. |
| Sucesso | Confirmar somente depois da resposta do dono real da operação. |
| Falha | Mensagem humana, opção segura de repetir e código técnico em detalhe. |
| Conflito | Expor escolhas e consequências; não sobrescrever silenciosamente. |

Sem prazo universal inventado: o adapter informa timeout, possibilidade de cancelamento e repetição. Repetir operação não idempotente requer chave de operação ou confirmação de resultado anterior.

### 4.3 Salvamento e persistência

- Preferências simples podem aplicar imediatamente, com indicação de salvamento real. Falha precisa desfazer o efeito ou marcar “não salvo”.
- Formulários de perfil usam Salvar/Cancelar e detecção de alterações não salvas.
- Preferências, navegação local, metadados de arquivos e sessão de conta têm escopos separados.
- Não armazenar tokens em metadata de workspace, URLs, logs, imagens ou repositório.
- Persistir somente após mudança efetiva, com agrupamento de gravações frequentes e limites adequados ao USB.
- Preservar estado durante recarga da Surface; operações de longa duração não podem depender da existência de um nó DOM.
- Dados de uma conta não devem reaparecer após troca para outra conta sem autorização e isolamento explícitos.

### 4.4 Acessibilidade e teclado

- Elementos semânticos, nomes acessíveis, foco visível e contraste legível nos dois temas.
- Navegação por Tab/Shift+Tab; Enter/Espaço nas ações; Escape fecha o contexto transitório mais próximo.
- Menus e diálogos devolvem foco ao acionador; diálogos modais contêm o foco.
- Estado não depende só de cor. Ícone, texto e atributos acessíveis devem transmitir seleção, erro e alerta.
- Movimento reduzido e escala de texto sem cortar controles.
- `Ctrl+K` continua abrindo o lançador; em ambientes que reservem atalhos, oferecer alternativa visível. Não capturar combinações de edição globalmente.
- Não anunciar cada heartbeat em `aria-live`; anunciar mudanças relevantes.
- Alvos de toque confortáveis; usar 44 px como meta de projeto para controles principais.

### 4.5 Responsividade e desempenho

- Desktop amplo: rail principal, navegação interna e conteúdo lado a lado.
- Janela média: reduzir larguras e título; conteúdo permanece legível.
- Tela estreita: navegação interna vira lista com retorno ou painel recolhível; não espremer três colunas.
- Listagens grandes usam carregamento paginado/incremental ou virtualização com acessibilidade preservada.
- Nenhuma leitura recorrente deve criar loops duplicados por reabrir a janela.
- Desinscrever listeners e descartar respostas antigas depois de mudar local, fechar app ou trocar conta.
- Conteúdo de nomes de arquivo, perfil e erro entra como texto, nunca como HTML confiável.

## 5. Área de trabalho e barra lateral

### 5.1 Área inicial

**Objetivo:** ponto de partida para trabalhar, sem ser um painel técnico.

**Conteúdo:** marca OrdaX discreta, área atual, relógio/data reais, Abrir aplicativo, atalhos Documentos/Imagens/Downloads quando acessíveis e composição visual de fundo.

**Ações:** abrir lançador; abrir pasta diretamente no app Arquivos; retornar à mesa mantendo janelas; alternar/criar áreas conforme os limites do workspace.

**Comportamento:** relógio usa formato/fuso suportado; decoração não intercepta cliques; atalhos sem acesso não fingem abrir pasta. Retirar marcadores temporários de entrega/investigação do texto normal, preservando informação de build em Sistema → Sobre.

**Estado/lacuna:** EXISTE em grande parte; P0 para clareza, estados e ligação uniforme aos destinos. Personalização dos atalhos e nome das áreas é evolução posterior.

**Aceite:** abrir Downloads leva a `/Downloads` no espaço autorizado; voltar à mesa não fecha o app; horário não é texto fixo; offline não remove pastas locais.

### 5.2 Rail principal

Ordem estável: Arquivos, Ajustes, Conta, Sistema. Ícone e rótulo sempre identificáveis. Indicar app ativo e, separadamente, app aberto; não usar a mesma marca para significados diferentes.

O rail representa aplicativos, não suas subseções. Não adicionar Atualizações, Segurança ou Armazenamento ao rail. A adaptação móvel preserva os quatro destinos com um componente responsivo compartilhado.

### 5.3 Lançador

**Primeira entrega:** buscar os quatro apps com correspondência por nome e termos úteis, sem inventar apps instalados.

**Evolução:** resultados de ações/destinos, como “Aparência — Ajustes”, “Atualizações — Sistema” e “Sincronização — Conta”. Mostrar contexto do resultado. Não misturar pesquisa de arquivos remotos sem consentimento/serviço.

**Aceite:** teclado seleciona/abre; Escape fecha e restaura foco; resultado vazio informa “Nenhum aplicativo encontrado”; atalhos não criam instâncias singleton duplicadas.

### 5.4 Áreas, janelas e rodapé

- Preservar o contrato atual `ordax.workspace-store/2` e seu limite observado de oito áreas.
- `+` cria uma área real; no limite, indicar o limite sem falhar silenciosamente.
- Minimizar, maximizar, restaurar, fechar e mover janelas não devem misturar estados de áreas diferentes.
- Ao criar remoção/renomeação de áreas, especificar destino das janelas e migração do estado; não adicionar botões antes disso.
- Rodapé mostra área, apps abertos, conectividade e resumo de atualização disponível.
- Clique no estado de atualização abre **Sistema → Atualizações**. Um resumo rápido pode existir, mas usa a mesma tradução e os mesmos dados.
- Conectividade resumida encaminha a **Ajustes → Rede e conexões**, se útil e suportado.

### 5.5 Energia e primeiro uso

Menu de energia chama o mesmo serviço usado por Sistema → Energia. Diferenciar sair da conta, fechar a interface e desligar a máquina. Web/Desktop hospedado não deve sugerir desligamento do host sem capacidade correspondente.

Primeiro uso pode explicar onde estão arquivos, ajustes e sistema em uma ajuda curta e dispensável. Não exigir conta para explorar ou usar capacidades locais. Assistente de instalação e escrita de mídia não fazem parte desse onboarding.

## 6. Arquivos: telas e operações

### 6.1 Finalidade e limites

Arquivos organiza **conteúdo do usuário em raízes autorizadas**. Não é um gerenciador de partições, editor do sistema, terminal ou ferramenta de manutenção de releases. Caminho lógico `/` significa raiz do espaço concedido, não a raiz Linux.

Preservar o bloqueio atual de acesso ao sistema e escapes por links simbólicos. Novas operações precisam validar o alvo no backend, inclusive depois de resolver caminhos e durante a execução.

### 6.2 Estrutura comum do gerenciador

**Topo:** Voltar/Avançar, subir um nível, breadcrumbs, busca no local, Atualizar e Nova pasta. Mostrar só operações implementadas.

**Navegação interna:** Meu espaço; Recentes; Favoritos; Documentos; Imagens; Downloads; locais adicionais e Lixeira quando disponíveis.

**Conteúdo:** inicialmente lista com Nome, Tipo e Tamanho. Adicionar Modificado somente com dado real no contrato. Modo grade/miniaturas vem após leitura segura de conteúdo.

**Rodapé contextual:** quantidade de itens, quantidade selecionada e operação em andamento. Espaço livre pode aparecer como resumo com atalho para Sistema → Armazenamento.

**Seleção:** clique seleciona, Ctrl/Cmd alterna seleção e Shift amplia intervalo. Duplo clique/Enter abre. Para toque, toque abre e seleção múltipla usa modo explícito. Não depender de menu de contexto para ações essenciais.

**Persistência:** local e modo de exibição por janela/área, conforme contrato de navegação; referências removidas não devem impedir reabertura.

### 6.3 Meu espaço — entrada padrão

**Mostrar:** título Meu espaço; pastas e arquivos reais da raiz autorizada; breadcrumb inicial; acesso às três pastas usuais.

**Ações:** navegar, atualizar, criar pasta e, nas fases seguintes, selecionar e operar em itens.

**Vazio:** “Seu espaço ainda está vazio”, com Nova pasta e Importar arquivos somente quando essa operação existir.

**Indisponível:** “Este ambiente ainda não oferece acesso a arquivos locais.” No Web futuro, oferecer Escolher pasta apenas com adapter suportado e autorização explícita.

**Aceite:** listagem coincide com dados reais; criar pasta atualiza o local correto; falha mantém caminho e contexto; não anunciar diretório como nuvem por padrão.

**Estado:** PARCIAL; listagem, navegação e criação existem no Native. P1 para melhorar seleção e ações.

### 6.4 Documentos

**Mostrar:** conteúdo real do local lógico Documentos, com a mesma barra e operações do gerenciador. Não é uma tela separada com regras copiadas.

**Abrir:** usar associação de tipo ou visualizador disponível. Sem aplicativo compatível, explicar “Ainda não há um aplicativo para abrir este tipo de arquivo” e oferecer exportação quando possível.

**Não fazer:** criar editor fictício, executar arquivos ou abrir conteúdo HTML com privilégios do host.

**Aceite:** mudança de pasta atualiza breadcrumb; nome longo tem acesso ao texto completo; arquivo desconhecido continua copiável/exportável.

**Estado:** navegação EXISTE; leitura, abertura e associações são NOVO/P1-P2.

### 6.5 Imagens

**Mostrar:** lista primeiro; grade com miniaturas geradas sob limites de tamanho e memória quando houver leitura segura. Dimensões e formato só se obtidos do arquivo.

**Visualização:** painel ou visualizador somente leitura, com zoom, ajustar à janela, próximo/anterior e fechar. Orientação deve respeitar metadados suportados sem regravar o original.

**Falhas:** arquivo corrompido apresenta placeholder e preserva acesso ao item; arquivo enorme não deve bloquear toda a Surface; cache de miniaturas tem limite e pode ser limpo sem apagar originais.

**Aceite:** imagem malformada não derruba a sessão; exportação mantém bytes originais; preferência de wallpaper usa referência/importação controlada, não injeta URL arbitrária.

**Estado:** pasta EXISTE; miniaturas/visualizador NOVO/P2.

### 6.6 Downloads

**Mostrar:** arquivos presentes na pasta Downloads. Ordenação por data somente depois de estender o contrato com timestamps reais.

**Ações:** abrir, mostrar detalhes, mover para outro local autorizado e excluir via lixeira quando implementado.

**Limite:** a pasta não é automaticamente um gerenciador de transferências. Uma futura área “Transferências” requer serviço que conheça progresso, origem, pausa e cancelamento. Não inventar downloads em andamento.

**Aceite:** atualizar a pasta revela novos itens; nada é executado automaticamente; arquivo parcial só recebe esse estado se o dono da transferência o informar.

### 6.7 Recentes

**Mostrar:** arquivos efetivamente abertos pelo OrdaX, com nome, local e momento de acesso registrado. Não usar exemplos ou inferir todos os arquivos do disco.

**Ações:** abrir, mostrar na pasta, remover da lista, limpar histórico local.

**Comportamento:** remover da lista não apaga o arquivo; localizar item removido mostra “Arquivo não encontrado” e permite retirar a referência. Retenção limitada e controle para desativar o histórico.

**Persistência:** índice local delimitado e isolado por perfil. Não sincronizar caminhos absolutos do dispositivo.

**Estado:** NOVO/P2. **Aceite:** limpar recentes preserva todos os arquivos e informa que somente o histórico foi apagado.

### 6.8 Favoritos

**Mostrar:** atalhos fixados pelo usuário para arquivos/pastas autorizados, sem duplicar conteúdo.

**Ações:** adicionar, remover favorito, ordenar e mostrar localização. Remover favorito não exclui o original.

**Comportamento:** caminho quebrado deve ser identificável; ao renomear/mover via OrdaX, atualizar a referência se a identidade do item for preservada. Tratar movimentos externos como referência potencialmente inválida.

**Persistência:** local inicialmente; identidade portátil de arquivo exige contrato próprio antes de sync.

**Estado:** NOVO/P2. **Aceite:** favorito sobrevive ao reload, mas nunca concede uma permissão que deixou de existir.

### 6.9 Locais e unidades

**Mostrar:** somente raízes e volumes expostos pelo adapter: nome, disponibilidade, leitura/escrita e espaço quando medido. Um local conectado pelo usuário é diferente do disco do sistema.

**Ações:** abrir, solicitar acesso, remover concessão e ejetar apenas se houver API segura. Ejeção deve verificar operações pendentes e falhar com mensagem se o volume estiver em uso.

**Limites:** não mostrar `/proc`, `/sys`, partições de boot ou `.ordax` como pastas comuns editáveis. Não incluir Formatar, Reparticionar ou Instalar no menu desta tela.

**Estado:** FUTURO/P2; o contrato atual cobre uma raiz, não inventário de volumes. **Aceite:** desconectar dispositivo não leva a operações no volume errado nem reutiliza concessão antiga automaticamente.

### 6.10 Lixeira

**Mostrar:** nome original, local original, data de exclusão e tamanho quando conhecidos; total de itens e espaço calculável.

**Ações:** restaurar selecionados, excluir definitivamente selecionados e esvaziar. Restauração com conflito pergunta entre manter ambos, escolher destino ou cancelar; sobrescrita precisa ser explícita.

**Sem backend de lixeira:** não renomear exclusão permanente para “Mover para lixeira”. Antes de oferecer exclusão, declarar a semântica real e confirmar o efeito.

**Persistência:** mover dados e registrar origem de forma resistente a interrupções. Item e metadata não podem divergir silenciosamente. Limites/limpeza automática exigem política explícita, sem surpresa destrutiva.

**Estado:** NOVO/P2. **Aceite:** restaurar mantém conteúdo; apagar definitivamente exige confirmação com quantidade/escopo; lixeira de um volume removido não aparece como vazia por engano.

### 6.11 Busca e detalhes

**Busca inicial:** filtrar nomes na pasta atual e declarar esse escopo. Busca recursiva posterior precisa de cancelamento, limite e resultados incrementais. Busca no conteúdo de documentos é outra capacidade, posterior.

**Resultados:** nome, tipo e localização; abrir item ou revelar sua pasta; mostrar “Nenhum resultado” com opção de limpar filtros.

**Detalhes:** nome completo, tipo, tamanho, local e acesso. Datas, checksum e volume somente quando disponíveis; cálculo de hash é sob demanda e não trava a UI. Nunca exibir tamanho recursivo de pasta como zero quando não foi calculado.

**Aceite:** pesquisa “relatório” não executa comandos; caracteres especiais e nomes Unicode são tratados como dados; uma resposta antiga não substitui resultado de consulta mais recente.

### 6.12 Operações a acrescentar e semântica mínima

| Operação | Fluxo esperado | Erros e integridade |
|---|---|---|
| Nova pasta | Nome → validação → criação → seleção do item criado. | Nome inválido, já existe, leitura apenas e espaço insuficiente com mensagens distintas. |
| Renomear | Editar nome atual, preservar seleção e atualizar referências locais. | Nunca sobrescrever colisão sem escolha; validar novamente no backend. |
| Copiar | Selecionar → copiar → destino → colar → progresso real. | Manter origem; tratar resultado parcial por item; não publicar sucesso antes do término. |
| Mover | Selecionar → recortar → destino → confirmar resultado. | Entre volumes: só remover origem depois de cópia e verificação suficientes; interrupção não pode apagar as duas cópias. |
| Importar | Seleção do host → escolha do destino autorizado → conflito/progresso. | Limites, arquivo grande, disco cheio e revogação tratados. |
| Exportar | Escolher item → destino mediado pelo host/download. | Não enviar à rede ou compartilhar publicamente por implicação. |
| Abrir | Resolver tipo → visualizador/app autorizado. | Tipo desconhecido tem fallback; scripts não executam automaticamente. |
| Excluir | Lixeira quando suportada; caso contrário ação permanente explicitamente identificada. | Quantidade e escopo visíveis; nunca atingir pastas de sistema. |

Para conflitos de cópia: Manter ambos, Substituir ou Ignorar; “Aplicar aos próximos” somente com escopo claro. Copiar/mover uma pasta para dentro de si deve ser rejeitado. Cancelamento significa interromper com resultado conhecido; não prometer desfazer bytes já concluídos sem suporte transacional.

### 6.13 Backlog resumido de Arquivos

- **P0:** preservar raiz delimitada e adapter atual; mapear erros estruturados; impedir respostas fora de ordem e controles falsos.
- **P1:** seleção, ordenação por campos existentes, detalhes, abertura/leitura segura básica, importação/exportação e renomear/copiar/mover com contrato e backend.
- **P2:** lixeira restaurável, favoritos, recentes, múltiplos locais, miniaturas e busca recursiva limitada.
- **P3:** conteúdo em nuvem, compartilhamento e versionamento de documentos, somente após identidade/serviço próprios.

É aceitável entregar P1 em vários incrementos. Cada operação só aparece quando sua implementação vertical estiver completa.

## 7. Ajustes: telas e preferências

### 7.1 Finalidade e organização

Ajustes controla **como o usuário interage com o OrdaX e com as capacidades locais disponíveis**. Não administra releases, partições, conta, assinatura ou recuperação do sistema.

Entrada padrão: **Aparência**. Busca “Buscar nos ajustes” filtra configurações implementadas e leva ao campo correto. Pesquisar “atualização” pode retornar um único atalho “Sistema → Atualizações”, sem criar uma seção duplicada.

Substituir linguagem interna como “o host expõe contratos” por descrição do efeito da opção. Informações de capacidades brutas passam para Sistema → Diagnóstico → Detalhes técnicos.

### 7.2 Aparência

**Objetivo:** escolher a apresentação da mesma Surface.

**Ordem visual proposta:**

1. Título Aparência e explicação curta.
2. Tema: Claro e Escuro, com miniaturas, nome e seleção acessível.
3. Papel de parede, somente quando implementado.
4. Atalho para tamanho de texto/contraste em Acessibilidade.
5. Feedback de persistência local; resumo de sync apenas se houver confirmação apropriada.

**Tema existente:** reutilizar `appearance.theme`, catálogo, runtime e stores. A troca precisa afetar rail, janela, diálogo, menu, toast, lista e foco; não somente o fundo da mesa.

**Tema Automático — P2:** adicionar valor e migração explícitos, usando uma fonte real de preferência do ambiente. Definir fallback se o adapter não a fornecer. Não inferir o tema por um horário fixo sem uma política comunicada.

**Papel de parede — P2:** começar com opções empacotadas localmente e composição geométrica padrão. Depois permitir imagem escolhida pelo usuário, com validação de formato/tamanho, prévia, recorte/preenchimento e Restaurar padrão. A referência ao arquivo precisa continuar válida após reinício; decidir importar cópia gerenciada ou manter concessão persistente.

**Cor de destaque — P3:** manter laranja na etapa atual. Oferecer paleta só depois de decisão sobre a identidade e de testes de contraste de todas as combinações. Não colocar cinco bolinhas clicáveis que não atualizam todo o design system.

**Estados:** lendo preferência; seleção aplicada/salvando; salva localmente; falha de persistência; valor antigo incompatível recuperado para padrão.

**Aceite:** trocar tema, fechar/reabrir e recarregar preserva o valor quando store disponível; erro de gravação é perceptível; desligar sync não impede tema local; origem desconhecida não injeta CSS/HTML.

**Estado:** tema EXISTE; refinamento P1; demais itens conforme fase acima.

### 7.3 Acessibilidade

**Mostrar:** opções por efeito, em grupos curtos: Leitura, Movimento e Navegação.

**Leitura:** tamanho de texto com escala e prévia; contraste reforçado; restaurar padrão da seção. Não prometer zoom de todo o sistema quando o adapter só altera a Surface.

**Movimento:** reduzir animações; respeitar preferência acessível do ambiente quando disponível, com possibilidade de escolha explícita. Persistir override do usuário de forma distinta da preferência herdada.

**Navegação:** acesso à lista de atalhos; indicação de uso por teclado; configurações de foco apenas quando efetivamente alteram a experiência. Cursor ampliado depende do host e não pode ser simulado apenas sobre parte da tela.

**Comportamento:** mudança tem efeito imediato e reversível; a própria página deve continuar utilizável com texto aumentado e contraste reforçado. Não esconder controles de acessibilidade atrás de login.

**Aceite:** 200% de zoom e largura estreita mantêm ações alcançáveis; reduzir movimento elimina animações não essenciais; leitores de tela identificam controles e estado; não há foco invisível em tema escuro.

**Estado:** NOVO/P1 para preferências da Surface; recursos de cursor/leitor do sistema P2 por adapter.

### 7.4 Área de trabalho

**Mostrar:** comportamento das áreas, restauração de janelas e atalhos da mesa; somente opções suportadas pelo workspace.

**Opções propostas:** restaurar apps/áreas da última sessão; restaurar posições localmente; escolher atalhos pessoais depois que Favoritos/ativação permitirem referências seguras; mostrar/ocultar relógio e escolher formato visual.

**Nomes/ordem das áreas:** evolução de contrato. IDs permanecem estáveis mesmo se o usuário renomear “Área 01” para “Trabalho”. Nome não vira chave de persistência.

**Restaurar layout:** ação que redefine posições/estado visual sem excluir arquivos, conta, preferências gerais ou histórico de atualização. Confirmar escopo e preservar rascunhos não salvos.

**Limite:** configurar preferência de restauração aqui; criar/trocar áreas permanece ação direta da mesa. Não criar outro gerenciador de áreas com estado independente.

**Aceite:** reabertura respeita a escolha; janela não reaparece fora da tela após mudança de resolução; restaurar layout não apaga dados pessoais; geometria local não é anunciada como sincronizada.

**Estado:** mecanismo de áreas/persistência EXISTE; editor de preferências PARCIAL/NOVO, P1-P2.

### 7.5 Idioma, data e hora

**Mostrar:** idioma da interface, formato de hora 12/24 h, formato regional de data/número e fuso de exibição, apenas após suporte real.

**Separar:** formato de apresentação da Surface é preferência; mudar relógio/fuso global da máquina é operação privilegiada do host. No Web, não expor controle que afirme alterar a hora do computador.

**Idioma:** português brasileiro é o conteúdo atual; oferecer outro idioma só quando traduções e fallback estiverem completos. Não criar menu com idiomas que deixam metade da UI em português.

**Consistência enquanto PT-BR for o único locale completo:** toda ação, mensagem e menu que pertence à Surface deve permanecer em português brasileiro. Chrome do navegador incorporado é detalhe de implementação e não deve vazar ações de fornecedor como `Back`, `Forward`, `Stop` ou `Reload`; até existir menu contextual próprio do OrdaX, o menu nativo da página deve ficar suprimido. A futura internacionalização deve centralizar mensagens e fallback por locale, sem espalhar condicionais de idioma pelos apps.

**Data/hora automática:** somente se o adapter administra essa configuração e relata estado. Mostrar origem da hora no detalhe técnico, sem abrir terminal.

**Aceite:** prévia reflete locale escolhido; timestamps persistidos mantêm representação não ambígua e são formatados na borda; erros de relógio não determinam resolução de conflitos de sync.

**Estado:** relógio formatado em pt-BR EXISTE. No Native, a Surface fixa a apresentação atual em `America/Bahia` e o host mantém sincronização NTP contínua/fail-soft para não depender do RTC incorreto do equipamento. A futura preferência de fuso deve substituir essa constante por um contrato neutro; não deve criar um segundo relógio do sistema. Preferências de idioma/formato continuam NOVO/P2.

### 7.6 Rede e conexões

**Primeira versão somente leitura:** estado conhecido de conexão; última tentativa real de serviço quando relevante; descrição clara do limite do ambiente. `network.https` não autoriza gerenciar Wi-Fi.

**Com adapter de gerenciamento — P2:** rede atual, conexão cabeada/Wi-Fi, sinal quando medido, lista de redes, Conectar/Desconectar e redes conhecidas. Painel avançado com endereços somente se disponibilizados com escopo apropriado.

**Conectar ao Wi-Fi:** selecionar rede → informar credencial em campo protegido → solicitar conexão → acompanhar resultado. Não guardar senha em preferências comuns, workspace, telemetria ou logs.

**Estados:** sem adapter, rádio desligado, procurando, nenhuma rede, conectando, credencial recusada, conexão local sem acesso ao serviço, online e offline. Portal cativo exige suporte específico; não deduzir só de erro HTTP.

**No Web/Desktop hospedado:** mostrar informação possível e, se houver API, encaminhar ao ajuste do sistema hospedeiro. Não desenhar um controle de Wi-Fi fictício.

**Aceite:** conectividade muda sem recarregar; perda de rede não fecha apps locais; erro de autenticação de rede não é mostrado como senha da conta inválida.

**Estado atual:** `ordax.network-status/1` continua responsável pela observação somente leitura e `ordax.network-management/1` pelo gerenciamento Wi-Fi no Native, ligado ao broker do host que reutiliza `iw`, `ip`, `wpa_supplicant`, `udhcpc` e `/state/network/wpa.conf`. **Ajustes → Rede** já oferece Procurar redes, seleção, senha protegida, Conectar, Desconectar, Esquecer e Reconectar quando a porta real está disponível. A senha existe apenas no input e no pedido transitório de conexão, é limpa da UI antes da operação e não entra em preferências, workspace, telemetria ou logs. O Web continua sem controles mutáveis quando não há adapter real. O suporte atual lista redes PSK compatíveis; redes abertas, WPA-Enterprise, WPA3-only e portal cativo permanecem fora deste incremento até contratos próprios. A bandeja fixa do shell consome somente `ordax.network-status/1`: diferencia Wi‑Fi/cabo e apresenta força aproximada do sinal Wi‑Fi, sem transportar SSID, MAC, BSSID ou credenciais. Quando a porta detalhada não existe, o indicador genérico Online/Offline continua como fallback.

### 7.7 Dispositivos e som

**Grupos condicionais:** Tela; Teclado e ponteiro; Áudio; Bluetooth/outros periféricos.

| Grupo | Conteúdo proposto | Comportamento necessário |
|---|---|---|
| Tela | Resolução, escala, brilho e monitores detectados. | Alteração que possa deixar tela inutilizável exige prévia e reversão automática se não confirmada. |
| Teclado e ponteiro | Layout, repetição, botão principal, velocidade e rolagem natural quando suportados. | Campo de teste; aplicar configuração só ao recurso sob controle do adapter. |
| Áudio | Saída, entrada, volume, mudo e teste local. | Indicar ausência de dispositivo; captura/teste de microfone requer consentimento e término evidente. |
| Bluetooth | Estado, buscar, parear, desconectar e esquecer. | Progresso, cancelamento e confirmação do código de pareamento quando exigido. |

**Limite:** esses são periféricos físicos locais. A seção Conta → Dispositivos e sessões contém vínculos autenticados e não pode reutilizar essa lista como se fosse a mesma coisa.

**Aceite:** remover periférico atualiza a lista; volume exibido vem de leitura confirmada; cancelar pareamento não inventa sucesso; controle ausente não aparece como desligado.

**Estado:** NOVO/P2, com áudio/suspensão/aceleração dependentes de validação física própria. Não bloquear P1 nesses itens.

### 7.8 Notificações e permissões

**Notificações:** ativação do recurso, som quando disponível, modo Não perturbe e preferências por app que realmente emite notificações. Histórico/central depende de serviço comum, não de listas independentes em cada app.

**Permissões locais:** recursos concedidos a apps — arquivos selecionados, notificações, mídia etc. Mostrar estado real, escopo e revogação suportada. Alterar nesta tela não pode contornar o diálogo de permissão do host.

**Privacidade local:** preferência do histórico de recentes e ligação para limpeza em Arquivos; política de coleta diagnóstica, se adotada, tem edição única aqui. Sistema → Diagnóstico mostra o estado dessa política e permite exportação pontual.

**Não perturbe:** suprime avisos não essenciais; não deve ocultar resultado de uma ação destrutiva iniciada pelo próprio usuário ou uma confirmação necessária.

**Aceite:** revogar acesso impede novas leituras no backend; mudanças afetam um store comum; desligar notificações não interrompe operações de arquivos ou recuperação.

**Estado:** NOVO/P2. A existência de telemetria técnica atual não prova que já há controles de consentimento, retenção ou preferência de coleta na UI.

### 7.9 O que não deve permanecer em Ajustes

Remover Atualizações, Armazenamento, Recuperação, Sobre e a listagem técnica de capacidades como páginas concorrentes. Senha/duas etapas ficam em Conta → Segurança. Ajustes pode oferecer links, nunca uma segunda implementação dessas funções.

## 8. Conta: identidade e continuidade

### 8.1 Regra de entrada e quatro estados fundamentais

Conta representa **a identidade OrdaX e o estado que pode acompanhar essa identidade**. Continuar usando capacidades locais não exige autenticação artificial.

| Estado | Conteúdo da entrada | Ação permitida |
|---|---|---|
| Serviço de identidade indisponível | “A conta OrdaX ainda não está disponível neste ambiente.” Dados locais continuam utilizáveis. | Informação sobre estado local; nenhum botão de login que simula sessão. |
| Serviço disponível, sem sessão | Explicar benefício da conta sem prometer capacidades ausentes. | Entrar, somente se anunciado pelo provedor. |
| Sessão válida | Perfil confirmado e resumos reais de sessão/sync. | Gerir capacidades efetivas e Sair. |
| Sessão expirada ou sem confirmação online | Perfil local identificado como última informação conhecida, se política permitir. | Reautenticar; operações de servidor seguem bloqueadas até validação. |

Uma desconexão não prova revogação, e um cache de perfil não prova sessão válida. O serviço de identidade deve fornecer esses estados; a UI não decodifica ou confia em token por conta própria.

### 8.2 Visão geral

**Objetivo:** responder “quem está conectado e o que está sendo mantido entre dispositivos?”.

**Sem provedor, na etapa atual:** estado honesto de indisponibilidade; indicação de que preferências/workspace permanecem locais; fila local, se exposta, descrita como preparação sem envio à nuvem. Detalhes técnicos ficam recolhidos.

**Com sessão real:** nome e avatar confirmados, identificador de contato somente se fornecido, estado da sessão, resumo da última sincronização confirmada e quantidade de pendências. Resumo do dispositivo atual somente se houver registro real.

**Ações:** Editar perfil → Perfil; Revisar segurança → Segurança; Gerenciar sessões → Dispositivos e sessões; Ver sincronização → Sincronização; Sair da conta.

**Saída:** informar o efeito sobre cache e pendências de sync conforme política. Invalidar a sessão e limpar material sensível; não apagar arquivos locais nem afirmar revogação remota se ela falhou.

**Aceite:** perfil não usa dados fixos; `unavailable` difere de `signed-out`; não há “Sincronização ativa” só porque uma capacidade foi declarada; troca de conta não reaproveita fila da anterior.

**Estado:** estrutura/portas PARCIAL; provedor e experiência autenticada FUTURO/P2.

### 8.3 Perfil

**Campos:** nome de exibição; avatar opcional; idioma de comunicação se o serviço o suportar; contato de acesso e verificação, se aplicáveis ao provedor.

**Separar:** o idioma da interface fica em Ajustes; idioma de comunicação da conta não altera automaticamente todas as telas.

**Ações:** Editar, Salvar, Cancelar, remover avatar. Troca de e-mail, se for identificador de acesso, é fluxo verificado do provedor e não simples edição livre de texto.

**Validação:** comprimento e caracteres permitidos; arquivos de avatar com limites; mensagens junto do campo. Usar nome de exibição como texto e não chave de autorização.

**Offline:** permitir rascunho apenas se contrato suportar; não indicar salvo no servidor sem confirmação. Troca concorrente precisa de revisão/erro de versão, não perda silenciosa.

**Aceite:** cancelar mantém perfil anterior; falha conserva rascunho; conteúdo do avatar é tratado com segurança; salvar em uma conta não altera outra.

**Estado:** NOVO/P2; não habilitar formulário antes do serviço de perfil.

### 8.4 Segurança

**Mostrar conforme provedor:** métodos de entrada, senha quando aplicável, passkeys quando suportadas, segundo fator, códigos de recuperação e eventos recentes de segurança quando houver dados autorizados.

**Não assumir senha:** um provedor pode usar login federado ou passkey; nesse caso não mostrar Alterar senha como se fosse uma credencial mantida pelo OrdaX.

**Fluxos:** adicionar/remover método requer reautenticação quando apropriado; ativar segundo fator só termina após comprovação; mostrar códigos de recuperação somente no fluxo autorizado e nunca enviá-los a logs ou sync comum.

**Limites:** não implementar criptografia, autenticação, biometria ou recovery codes manualmente em componentes de interface. A Surface consome portas neutras e ações oferecidas por integração auditável.

**Estados:** método disponível, configuração pendente, reautenticação necessária, cancelado, concluído e erro. Evitar revelar detalhes que permitam enumerar contas.

**Aceite:** remover último método não bloqueia usuário sem política explícita; códigos e tokens não aparecem em diagnóstico; interface reflete resultado do provedor, não apenas toggle local.

**Estado:** FUTURO/P2-P3, dependente de identidade. A imagem conceitual não obriga a criar senha e duas etapas em paralelo ao provedor.

### 8.5 Dispositivos e sessões

**Mostrar:** sessões/vínculos retornados pelo serviço, nome amigável, tipo de cliente, última atividade confirmada, estado e identificação de “Este dispositivo”. Não mostrar localização geográfica inferida sem fonte/política.

**Ações:** renomear vínculo quando permitido, ver detalhes e Encerrar sessão. “Encerrar outras sessões” só quando o servidor suportar escopo exato e confirmação.

**Revogação:** descrever qual sessão perde acesso. O dispositivo offline só perceberá a revogação ao revalidar; não afirmar encerramento instantâneo de processos remotos.

**Identidade:** nome do dispositivo é rótulo; não é chave, serial confiável nem prova de posse. Evitar exibir tokens e IDs sensíveis desnecessários.

**Aceite:** encerrar uma sessão não encerra todas por erro de escopo; sessões desconhecidas do backend não são inventadas a partir da telemetria operacional; periféricos não aparecem nessa lista.

**Estado:** FUTURO/P2.

### 8.6 Sincronização

**Objetivo:** dizer o que pode acompanhar a conta, o que está só neste dispositivo e o que precisa de atenção.

**Conteúdo básico:** estado real do transporte, última sincronização confirmada, contagem de pendências, uso de fila persistente/somente sessão, classes de dados autorizadas e conflitos que exigem escolha.

**Classes iniciais candidatas:** aparência, preferências suportadas e metadata portátil de áreas/apps. Geometria de janela, tokens, chaves privadas, drivers, estado RAW e caches permanecem locais. Conteúdo de arquivos na nuvem é expansão separada.

**Estados propostos:**

| Estado | Mensagem funcional |
|---|---|
| Sem transporte autorizado | “As alterações permanecem neste dispositivo.” |
| Sessão necessária | “Entre para sincronizar”, somente com login real disponível. |
| Aguardando conexão | “Há alterações locais aguardando conexão.” |
| Sincronizando | Progresso/fase conhecidos, sem percentual inventado. |
| Sincronizado | Somente após confirmação de revisão/cursor do servidor. |
| Conflito | Identificar objeto/classe e apresentar opções do resolvedor. |
| Falha de autorização | Reautenticação ou ação apropriada, sem descarte da fila. |
| Fila só nesta sessão | Aviso antes de encerrar/recarregar quando houver pendências não duráveis. |

**Ações futuras:** Sincronizar agora, pausar envio, escolher classes e resolver conflitos. Cada ação precisa de suporte no runtime; um botão não ativa infraestrutura por conta própria.

**Persistência/conflitos:** preservar idempotência, revisões, tombstones e cursores. Não usar relógio do cliente como autoridade; não aplicar “último vence” a todos os dados. Documentar o resolvedor por classe.

**Desativar sync:** esclarecer que interrompe novos envios, sem apagar automaticamente cópias locais ou remotas. A remoção de dados tem fluxo próprio.

**Aceite:** alterar tema offline mantém tema e fila; reiniciar com store durável conserva pendências; mesma mutação reenviada não duplica efeito; mudança de usuário não envia estado para conta errada; fila vazia não é sinônimo de nuvem sincronizada.

**Estado:** núcleo/fila/ponte de preferências EXISTEM; transporte, conta e controles completos PARCIAIS/FUTUROS. P1 para apresentação honesta, P2 para continuidade ponta a ponta.

### 8.7 Dados e privacidade

**Mostrar:** categorias de dados associadas à conta, política aplicável, solicitações de exportação/eliminação e consequências claras. Não inventar prazo de retenção, quota, plano ou serviço jurídico/comercial.

**Exportar dados:** criar pedido no serviço, acompanhar resultado e permitir obtenção por canal autenticado. Exportação da conta não inclui automaticamente arquivos locais do dispositivo.

**Excluir conta/dados:** ação separada de Sair; apresentar quais dados serão apagados, efeito sobre dispositivos e eventual etapa de verificação do provedor. Só oferecer quando o backend e a política estiverem definidos.

**Privacidade local:** indicar link para Ajustes → Notificações e permissões; não repetir seus editores. Diagnóstico exportado pertence ao fluxo de Sistema, com revisão explícita.

**Aceite:** pedido rejeitado não vira confirmação de exclusão; download não é URL pública permanente; sair da conta não exclui dados pessoais por surpresa.

**Estado:** FUTURO/P3. Planos e cobrança permanecem fora desta etapa; continuidade básica não pode ser artificialmente bloqueada por assinatura.

## 9. Sistema: estado e manutenção

### 9.1 Finalidade e navegação

Sistema responde **o que está executando, se há algo que exige atenção e como manter/reparar esse ambiente**. Informações avançadas ficam em detalhes; não transformar toda a experiência em painel de desenvolvedor.

Entrada padrão: **Visão geral**. Navegação: Visão geral, Atualizações, Armazenamento, Diagnóstico, Recuperação, Energia quando suportada e Sobre.

Resumos são permitidos em Visão geral. Gestão completa fica na subseção correspondente. O mesmo dado deve usar o mesmo seletor/formatter e a mesma fonte em todos os locais.

### 9.2 Visão geral — especificação detalhada

**Pergunta respondida:** “Qual OrdaX estou usando e há algo que eu precise fazer?”.

#### Ordem do conteúdo

1. **Cabeçalho:** Sistema / Visão geral, nome OrdaX e identificação do ambiente real, como Desenvolvimento, quando fornecida pela composição.
2. **Resumo de estado:** “Em execução”, “Atenção necessária”, “Offline” ou “Estado parcial”, com justificativa. Não declarar saúde global só porque a Surface renderizou.
3. **Versão:** identificador realmente executado, última leitura e link para Sobre/Atualizações. Distinguir SHA do checkout, versão servida e versão ativada se o backend permitir; divergência não deve ser escondida.
4. **Atualização:** fase/resultado atual, horário da última verificação e ação Ver atualizações. Sem comando manual se não houver porta correspondente.
5. **Recursos:** memória e espaço do usuário com valores medidos; tempo ligado. Nomear explicitamente o escopo do armazenamento e não apresentá-lo como todo o disco.
6. **Conectividade:** estado observado e link para Ajustes → Rede e conexões quando útil.
7. **Avisos acionáveis:** versão fixada, falha de atualização, dados antigos, pouco espaço ou reinício/revisão de base necessário — somente quando conhecidos.
8. **Atalhos finais:** Diagnóstico, Armazenamento, Sobre e Energia disponível.

#### Campos e fontes

| Campo | Fonte inicial | Ausência/limite |
|---|---|---|
| Versão do runtime | Watcher/status real quando presente. | “Versão não informada”; nunca usar o SHA consultado no GitHub como se estivesse instalado. |
| Modo/perfil de execução | Metadata explícita da composição/host, a acrescentar se necessário. | Não inferir USB de uma URL, nome de janela ou mera presença de adapter Native. |
| Atualização e fase | `update-status` validado. | “Estado de atualização indisponível”. |
| Última verificação | `checkedAt` com semântica/atualidade válidas. | “Sem verificação registrada”. |
| Memória | `memoryTotalBytes`, `memoryAvailableBytes`. | Campo indisponível; não mostrar 0 GB. |
| Espaço do usuário | `userStorageTotalBytes`, `userStorageFreeBytes`. | Não extrapolar para capacidade do PhysicalDrive. |
| Tempo ligado | `uptimeSeconds`. | Não substituir pelo tempo desde abertura da página. |
| Conectividade | Snapshot do host. | Desconhecida não é Offline. |

**Métricas derivadas:** uso = total − disponível, com validação dos limites e unidade consistente; não chamar aproximação de “uso exato de aplicativos”. Denominador zero/ausente não produz barra enganosa.

**Atualizar leitura:** relê métricas locais; não procura atualização de software. Nome e ícone devem deixar essa diferença explícita.

**Estado antigo:** falha na nova leitura preserva valor anterior com “Última leitura às …”; invalidar “saudável” se dependia de dado expirado.

**Aceite:** uma falha em métricas não impede atualização/energia; Web mostra limites sem números inventados; aviso abre a subseção correta; commit não é confundido com release canônica assinada.

**Estado:** PARCIAL/P1; dados principais já existem, mas precisam de hierarquia, navegação, semântica de saúde e atualidade.

### 9.3 Atualizações — único centro de gestão

**Mostrar no topo:** versão em execução, perfil/canal real, última verificação concluída e situação atual. Detalhes de SHA completo, tentativa e origem ficam em painel técnico expansível.

**Separar três coisas:** observação de status, pedido de verificação e aplicação/ativação. A porta de status atual não implementa automaticamente as outras duas.

#### Estados e comportamento

| Estado | Conteúdo principal | Ação possível |
|---|---|---|
| Sem integração | Explicar mecanismo do ambiente; manter versão disponível. | Sobre; documentação do cliente, se aplicável. |
| Ainda não verificado | “Nenhuma verificação concluída.” | Verificar, somente quando comando existir. |
| Verificando | Informar fase e preservar versão em uso. | Cancelar apenas se suportado. |
| Nova versão identificada | Versão alvo e impacto conhecido. | Baixar/aplicar conforme política real do perfil. |
| Baixando/validando | Fase e progresso medido; sem porcentagem fictícia. | Não permitir operações concorrentes incompatíveis. |
| Ativando/aguardando saúde | Informar interrupção prevista e validação. | Aguardar; não afirmar sucesso antes do health acknowledgement. |
| Aplicada e saudável | Versão ativada, horário e efeito confirmado. | Ver histórico. |
| Fixada | Explicar pausa e versão preservada. | Retomar acompanhamento só com comando explícito apropriado. |
| Falha/bloqueada | Motivo seguro, versão preservada e tentativa. | Diagnóstico e repetição permitida pelo serviço. |
| Revertida | Informar retorno à versão anterior e motivo disponível. | Ver evento; abrir Recuperação se necessário. |
| Mudança de base pendente | Explicar que o runtime não pode aplicar a mudança sozinho. | Instrução específica do adapter/plano, nunca presumir que reiniciar basta. |

#### Diferenças entre perfis

- **Desenvolvimento Git-first:** mostrar que acompanha `main`; preservar `pull --ff-only`, bloqueio de alterações locais, pin de rollback e validação de origem. Não chamar esse fluxo de release pública assinada.
- **Runtime da Surface:** mudança pode recarregar interface ou reiniciar somente a Surface/supervisor; preservar workspace e rascunhos/operações conforme seus donos.
- **Boot/kernel/base:** `bootRefreshRequired` indica necessidade de tratar base/boot. Um reboot isolado pode não aplicar bytes que nunca foram instalados. O adapter deve fornecer impacto e procedimento real antes de oferecer “Reiniciar para atualizar”.
- **Release canônica:** aquisição/verificação/ativação e manutenção de known-good seguem o contrato de release. Não criar bypass visual para trust pendente.
- **Web/Mobile/Desktop hospedado:** atualização do cliente é distinta da atualização do SO. Mostrar mecanismo real do cliente, sem expor controle de boot da máquina hospedeira.

#### Ações a acrescentar

“Verificar agora”, “Retomar atualizações”, “Ver histórico” e quaisquer ações de aplicação dependem de portas explícitas, permissões e idempotência. Nunca implementar botões que executam shell arbitrário ou chamam o relay de telemetria como plano de controle.

Uma verificação contra o remoto deve definir resultado e alvo. `running` sozinho pode ser traduzido como “Em execução”; “Atualizado” exige confirmação de que a versão observada corresponde ao alvo verificado naquele momento.

#### Histórico — subseção contextual

Lista cronológica limitada com data, versão anterior/alvo, resultado, tipo de aplicação e identificador da tentativa. Abrir evento mostra fases, falha sanitizada e rollback associado. Capturar eventos reais; não converter todo heartbeat repetido em item.

Histórico não oferece “Instalar qualquer commit”. Uma ação de rollback parte das versões autorizadas pelo dono de recuperação.

**Aceite:** duas tentativas não concorrem; status do rodapé e da página coincide; versão atual sobrevive à falha de rede; pin persiste até ação explícita; health token nunca é exibido/copied/exportado; histórico vazio é honesto.

**Estado:** status/watcher EXISTEM; centro unificado P0-P1; comandos/histórico NOVO/P2; release pública depende de gates separados.

### 9.4 Armazenamento

**Objetivo:** entender capacidade disponível e administrar espaço sem colocar arquivos ou o boot em risco.

**Primeira versão:** capacidade total/livre/usada do **espaço do usuário**, com horário da leitura e atalho Abrir arquivos. Usar exclusivamente os campos de métricas existentes.

**Evolução:** volumes autorizados, perfil detectado e separação lógica por categorias medidas: arquivos pessoais, apps, versões de sistema, estado persistente, cache/diagnóstico e reserva operacional. Não desenhar gráfico por categoria antes de haver medição confiável.

**Evitar contagem duplicada:** espaço lógico de snapshot, compressão, imagens e bytes físicos podem diferir. Não somar subvolumes de um pool como discos independentes nem contar imagem ext4 e seu conteúdo duas vezes. Explicar a unidade e o escopo.

**Ações:** abrir localização no app Arquivos; revisar cache removível; revisar lixeira; ver versões antigas autorizadas para limpeza. Toda limpeza apresenta categorias, estimativa, escopo e resultado por item.

**Proteções:** não apagar release em execução, único rollback conhecido-bom, atualização em andamento, estado persistente ou arquivos pessoais sob rótulo “cache”. Diagnóstico pode ser descartável, mas retenção deve obedecer contrato.

**Perfis físicos:** o remoto inspecionado contém contratos de prova/transição e um contrato de arquitetura durável. A UI deve ler o perfil materializado, não fixar número de partições nas telas. Esta proposta não resolve por conta própria divergências históricas entre esses documentos nem altera geometria.

**Estado crítico:** pouco espaço deve explicar quais operações estão bloqueadas, especialmente staging de atualização, sem iniciar formatação ou apagar dados automaticamente.

**Aceite:** números correspondem à raiz consultada; espaço desconhecido não é zero; cancelar revisão de limpeza não altera bytes; mídia removida interrompe a ação de forma segura; reserva de atualização não aparece como partição inventada.

**Estado:** medição básica EXISTE; inventário/categorias/limpeza NOVO/P2.

### 9.5 Diagnóstico

**Objetivo:** explicar problemas atuais e produzir informação útil de suporte, inclusive offline, sem exigir terminal.

**Resumo inicial:** componente afetado, gravidade, momento, mensagem legível e ação sugerida. Exibir “Nenhum problema registrado” somente com consulta válida; ausência de telemetria não é prova de saúde.

**Visão técnica expansível:** versão servida/checkout quando disponíveis; estado da Surface, host e supervisor; fase/tentativa de atualização; capacidades reais; atualidade dos dados; eventos correlacionados.

**Saúde:** separar liveness, readiness e dado antigo. Um heartbeat recente do agente de base não prova que o supervisor progrediu. Usar os sinais apropriados já existentes, incluindo timestamp de estado do supervisor quando exposto pela porta, e mostrar desconhecido se não houver observação suficiente.

**Eventos:** filtros por componente, gravidade e período; página/limite; detalhe com código estável, mensagem, versão e correlação. Não usar o texto traduzido como identificador de erro.

**Ações:** atualizar leitura; copiar resumo sanitizado; exportar diagnóstico; abrir seção relacionada. Reiniciar serviço, limpar bloqueio ou reaplicar versão são ações de outro dono, nunca botões escondidos em uma tabela de logs.

**Exportação:** prévia do conteúdo → itens incluídos → remoção de dados sensíveis → arquivo local com manifesto. Enviar a terceiro é ação separada e explícita. Não exportar tokens, health token, chaves, credenciais, conteúdo de home ou caminhos pessoais sem classificação.

**Telemetria:** indicar origem, estado conhecido e limitações quando relevantes. Coleta observacional não concede autoridade de ação; falha do relay não impede a operação local. UI não deve depender de consulta direta a banco/fornecedor.

**Aceite:** arquivo exportado passa por redaction; rotação limita crescimento; erro de diagnóstico não derruba o sistema; o mesmo incidente tem correlação consistente; não exibir “Operando normalmente” com estado expirado.

**Estado:** infraestrutura/contrato PARCIAIS; UI/porta de consulta/exportação NOVO/P1-P2.

### 9.6 Recuperação

**Objetivo:** restaurar funcionamento preservando arquivos pessoais por padrão. Não apresentar toda ação como “resetar”.

| Ação | Significado | Exposição nesta etapa |
|---|---|---|
| Ver estado de recuperação | Mostrar versão atual/anterior autorizada e situação conhecida. | Primeiro incremento, quando dados existirem. |
| Voltar à versão anterior | Selecionar known-good permitido pelo perfil; no Git-first respeitar pin persistente. | Só com contrato e backend de ação; não inferir de mera string de SHA. |
| Reparar sistema | Repor implantação/artefatos do sistema mantendo dados pessoais conforme plano. | Futuro, exige implementação por perfil. |
| Redefinir estado persistente | Apagar/recriar classes específicas de estado, com consequências explícitas. | Futuro; diferente de reparar e de limpar cache. |
| Recriar mídia/restaurar de fábrica | Pode apagar dados e layout. | Fora da entrega normal; fluxo Creator e autorização destrutiva próprios. |

**Fluxo mínimo de ação:** escolher operação → avaliar disponibilidade/plano → informar o que muda, o que é preservado e limitações → confirmação explícita → executar → verificar → relatar resultado real.

**Offline:** permitir somente recuperação com material local válido. Não prometer download/reparo sem rede. Se não há versão elegível, explicar e oferecer diagnóstico/instrução pertinente.

**Rollback:** versão de sistema não é versão dos documentos. Confirmar compatibilidade dos formatos de estado e migrações; retornar código antigo não autoriza apagar ou reinterpretar dados novos silenciosamente.

**Rescue existente:** canal delimitado do protótipo é mecanismo separado e não vira botão genérico de comando remoto. Reutilizar somente ações cuja fronteira e requisitos permaneçam intactos.

**Aceite:** não escolher versão arbitrária; falha preserva caminho conhecido-bom; confirmação expõe consequências; recuperação não herda autoridade de formatação só por estar no app Sistema.

**Estado:** mecanismos de base PARCIAIS; interface local de ações NOVO/P2; reparação/factory reset FUTURO com gates próprios.

### 9.7 Energia

**Conteúdo inicial:** Reiniciar e Desligar, com descrição curta. A lista vem das ações realmente anunciadas pelo adapter.

**Confirmar:** “Reiniciar o dispositivo?” ou “Desligar o dispositivo?”, identificando que apps/transferências serão interrompidos. Reusar diálogo/serviço do rail. Uma ação pendente bloqueia repetição concorrente.

**Operações em andamento:** expor gravações/transferências conhecidas; permitir aguardar ou cancelar. Nunca alegar conhecer todos os processos do host se o adapter não oferece isso.

**Resultado:** falha mantém UI disponível e explica; sucesso aceito pelo host não deve virar toast “computador desligado” antes do desligamento efetivo.

**Depois:** suspensão, tempo para apagar tela, comportamento de tampa e perfis de energia só com capabilities e prova física. Política de energia tem esta seção como dono; brilho permanece Ajustes → Dispositivos e som.

**Aceite:** web sem capacidade não mostra power off funcional; Cancelar não envia comando; confirmação de origem/autorização existente é preservada; menu e página chamam o mesmo fluxo.

**Estado:** ações nativas EXISTEM; integração da página P1; demais opções FUTURO/P2.

### 9.8 Sobre

**Mostrar:** OrdaX, status de protótipo/desenvolvimento quando aplicável, versão/build realmente executado, modo/perfil fornecido e informações de licença/autoria disponíveis no source.

**Detalhes técnicos:** SHA completo copiável, identidade do bundle, runtime/kernel quando o adapter os fornecer. Não exibir dados da máquina obtidos por suposição ou fingerprinting desnecessário.

**Ações:** copiar informações do sistema sem segredos; abrir licenças incluídas; links oficiais explicitamente identificados; atalho Atualizações para a seção única.

**Regras:** componente de créditos/licenças empacotado deve funcionar offline. “Prova em CI”, “USB de desenvolvimento validado” e “release canônica autorizada” são estados diferentes; não usar selo genérico de “verificado” para fundi-los.

**Aceite:** versão copiada corresponde ao runtime identificado; fonte remota indisponível não impede leitura local; não há segunda página Sobre em Ajustes.

**Estado:** dados de versão PARCIAIS; tela consolidada NOVO/P1.

## 10. Contratos, dados e integração

### 10.1 Onde implementar

| Responsabilidade | Dono no source | Orientação |
|---|---|---|
| Identidade visual e tokens | `system/surface/ui/tokens.css`, `desktop-shell.mjs` e estilos compartilhados. | Evoluir a fonte existente; não usar PNG do conceito como interface. |
| Janelas, foco e áreas | `surface.mjs`, `surface-state.mjs`, `workspace-store.mjs`. | Preservar lifecycle, persistência e limites atuais. |
| Registro dos quatro apps | `system/apps/catalog.mjs` e `system/apps/*/app.mjs`. | Preservar IDs; padronizar rótulos visíveis. |
| Apresentação de cada app | `file-space-controls.mjs`, `settings-overview-controls.mjs`, `account-overview-controls.mjs`, `system-overview-controls.mjs`. | Evoluir extensões atuais e extrair componentes por seção quando necessário; evitar uma segunda implementação paralela. |
| Preferências | `system/services/preferences/` e `system/services/sync/preference-runtime.mjs`. | Registrar definição, validação, padrão, persistência e política de sync. |
| Semântica de identidade/sync | `system/services/account/`, `system/services/sync/`. | Serviços não conhecem fornecedor de banco, UI ou APIs concretas de host. |
| Portas neutras | `system/contracts/`. | Contratos pequenos ligados a uma necessidade real, sem criar framework especulativo. |
| Implementação por ambiente | `system/adapters/*/`. | Permissão, acesso físico, transporte e integração; sem duplicar política de produto. |
| Montagem das dependências | `system/composition/web/main.mjs`, `system/composition/native/main.mjs`. | Injetar portas; UI não importa adapter concreto. |
| Host nativo | `system/surface/runtime/native_host_server.py`. | Preservar fronteiras de origem, autorização, caminhos delimitados e validação no servidor. |
| Atualização e energia | Watcher, controles e serviços existentes. | Observação separada de comando; menu e página compartilham um dono. |

Não migrar para outro framework, adicionar serviço remoto ou trocar mecanismo de build como condição para reorganizar telas. Manter módulos e receitas existentes enquanto atendem ao requisito.

### 10.2 Navegação interna sem segundo roteador de produto

Proposta lógica, **não um schema já publicado**:

```json
{
  "appId": "system",
  "sectionId": "updates",
  "detailId": null
}
```

O contrato atual `app-activation/1` já possui `appId` e `target`. Arquivos usa `target` para caminho. Antes de estendê-lo, verificar se destinos internos podem ser validados pelo app sem mudar sua semântica. Se forem necessários novos campos incompatíveis, versionar explicitamente.

Requisitos de navegação:

- App interpreta somente os destinos que possui; rejeitar seção desconhecida e evitar transformar `target` em URL/comando arbitrário.
- Persistir a subseção por janela/área com schema versionado e migração de registros antigos.
- Deep link explícito seleciona seção mesmo se a janela estava minimizada ou em outro estado.
- Preserve foco e scroll ao atualizar um pequeno dado; não reconstruir toda a árvore a cada heartbeat.
- Metadata de navegação não amplia acesso nem carrega tokens, caminhos físicos privilegiados ou credenciais.

### 10.3 Formato mínimo para especificar cada novo recurso

Antes de implementar uma ação, preencher estes itens no PR/plano técnico:

| Item | Pergunta a responder |
|---|---|
| Dono | Qual serviço executa e qual app apresenta? |
| Capacidade | Como o adapter anuncia disponibilidade real? |
| Dados | Campos, tipos, unidades, escopo e fonte da verdade. |
| Comando | Parâmetros permitidos, validação e autorização. |
| Resultado | Como distinguir aceito, concluído, parcial e falhou? |
| Concorrência | Duplo clique, timeout, repetição e múltiplas janelas. |
| Cancelamento | Em que fase é possível e o que permanece concluído? |
| Persistência | O que sobrevive ao reload/reboot e qual schema? |
| Erros | Códigos estáveis, mensagem humana, ação e repetibilidade. |
| Privacidade | Dados locais, sincronizáveis, sensíveis e exportáveis. |
| Verificação | Cenário de sucesso e falhas relevantes no teste. |

### 10.4 Portas atuais e extensões necessárias

| Porta/área | O que reutilizar | O que precisa ser projetado, sem assumir que existe |
|---|---|---|
| File space | Raiz lógica, listagem e criação. | Identidade/metadata do item, leitura, mutações, transferências, concessões, lixeira e operações por item. |
| Preferências | Catálogo, validação, snapshot, store e runtime. | Novas definições, compatibilidade de valores antigos e escopo de cada preferência. |
| Workspace | Áreas/janelas e persistência v2. | Navegação interna e estado recuperável dos apps, preservando isolamento e limites. |
| Identity | Sessão e ações neutras existentes. | Provedor real, perfil, reautenticação, registry de sessões e revogação. |
| Sync | Classes, fila, revisões, idempotência e ponte local. | Transporte autenticado, autorização de servidor, confirmação e UX de conflitos. |
| Update status | Snapshot/fases e watcher. | Atualidade, versão efetivamente servida, comandos separados e histórico consultável. |
| Metrics | Memória, espaço do usuário e uptime. | Volumes, medição por categoria, hardware/energia e escopo explícito. |
| Diagnostics | Semântica de eventos/privacidade existente. | Porta de consulta local, retenção visível, agregação de saúde e exportação revisável. |
| Recovery | Mecanismos específicos e gates existentes. | Plano de ação local, elegibilidade, efeitos e execução limitada por perfil. |

Capacidade nova deve ser adicionada aos contratos canônicos no mesmo incremento que a implementa. Não usar `system.metrics` para autorizar limpeza nem `filesystem.user-space` como autorização automática para qualquer operação destrutiva.

### 10.5 Política proposta de escopo dos dados

| Dado | Escopo inicial | Sync futuro |
|---|---|---|
| Tema e preferências compatíveis | Dispositivo/perfil local. | Permitido por classe autorizada. |
| Geometria/minimização/maximização de janela | Dispositivo. | Continua local conforme boundary atual. |
| Áreas e apps abertos portáteis | Metadata filtrada. | Somente classes autorizadas, sem geometria/segredos. |
| Última pasta, recentes e concessões de arquivo | Dispositivo e perfil apropriado. | Não copiar caminhos absolutos/concessões para outra máquina. |
| Favoritos | Referências locais autorizadas. | Exige identidade de objeto portátil; não presumir. |
| Perfil de conta | Serviço autenticado; cache delimitado. | Dono é a conta, com revisões. |
| Tokens e chaves privadas | Armazenamento seguro do adapter. | Nunca em sync comum. |
| Diagnóstico/telemetria | Escopo operacional classificado. | Não equivale a sync da conta. |
| Arquivos pessoais | Local concedido. | Conteúdo remoto requer adesão e serviço próprios. |
| Estado de atualização/recuperação | Dono local do runtime. | Não é preferência portátil. |

### 10.6 Tratamento de erro e dados antigos

Propor uma representação neutra de erro com código estável, mensagem traduzível, possibilidade de repetir, escopo e ID de operação. Não usar regex na mensagem humana para decidir autorização ou retry.

Para snapshots observacionais, explicitar momento da leitura e fonte. Metadados de atualidade podem exigir extensão de contrato. Nunca calcular “supervisor saudável” a partir apenas da chegada do heartbeat de outro processo.

Dados não disponíveis devem ser `null`/estado declarado, conforme contrato, e não números fictícios. Não mudar significado de zero em schemas existentes sem migração.

## 11. Diferenças entre modos

Esta tabela descreve limites e metas de UX; não afirma que todos os adapters estão implementados.

| Área | Web | Mobile | Desktop hospedado | USB/Native |
|---|---|---|---|---|
| Arquivos | Só storage/acesso concedido pelo navegador e implementado no adapter; hoje sem file-space montado na composição inspecionada. | Sandbox, seletor do sistema e permissões efetivas. | Pastas concedidas pelo host; acesso não irrestrito por padrão. | Raízes de usuário delimitadas, hoje com listagem/criação nativas. |
| Aparência | Preferência da Surface. | Mesmo catálogo, layout responsivo. | Mesmo catálogo, integração opcional. | Mesmo catálogo e persistência nativa. |
| Rede/periféricos | Informação limitada e encaminhamento ao host quando possível. | APIs permitidas pela plataforma. | Integração explícita, sem presumir privilégio administrativo. | Gestão somente após adapter real e testes. |
| Conta | Mesma identidade, quando provedor existir. | Mesma identidade; secure storage do adapter. | Mesma identidade. | Mesma identidade; uso local continua possível. |
| Atualização | Cliente/deployment Web. | Aplicativo/store conforme canal. | Aplicativo instalado e seu canal assinado. | Perfil Git de desenvolvimento ou release canônica, identificados separadamente. |
| Energia | Não desligar computador. | Não desligar telefone pelo app. | Não desligar host por inferência. | Ações nativas anunciadas e confirmadas. |
| Creator | Sem RAW. | Sem RAW. | Capacidade privilegiada separada e gated. | Instalação/recuperação somente por requisitos explícitos próprios. |

USB e Native podem compartilhar adapter, mas o nome Native não comprova o perfil de armazenamento. Diferenciar runtime, mídia materializada e contrato de produto sem criar forks de UI.

## 12. Lacunas e ordem de implementação

### 12.1 Ordem recomendada de entregas

| Entrega | Conteúdo | Dependências | Saída verificável |
|---|---|---|---|
| E0 / P0 | Revalidar source, inventariar capacidades, padronizar Ajustes, mapear seções e destinos únicos. | `main` atual e contratos. | Mapa de navegação e inventário factual atualizados. |
| E1 / P0 | Navegação interna compartilhada, restauração por app, estados comuns e links entre apps. | E0. | Rail e subseções funcionam sem duplicação de janelas ou páginas. |
| E2 / P1 | Sistema: Visão geral, Atualizações observacionais, Sobre e Energia; remover traduções duplicadas. | E1, portas existentes. | Dados reais e atalhos únicos, inclusive rodapé. |
| E3 / P1 | Ajustes: Aparência e acessibilidade da Surface; retirar diagnóstico técnico da tela comum. | E1, catálogo/store. | Preferências reais, persistidas, acessíveis nos dois temas. |
| E4 / P1 | Arquivos básico completo em incrementos: seleção/detalhes, leitura/abertura, importação/exportação e mutações. | E1, extensões de contrato/backend por operação. | Fluxos de usuário com dados reais e proteção da raiz. |
| E5 / P1 | Conta com estados honestos e Sincronização local compreensível. | E1, identity/sync existentes. | Nenhuma identidade ou nuvem simulada; pendências locais explicadas. |
| E6 / P2 | Favoritos, recentes, lixeira, miniaturas, múltiplos locais e pesquisa ampliada. | E4. | Organização/restauração de arquivos testada. |
| E7 / P2 | Comandos de atualização, histórico, diagnóstico/exportação e armazenamento detalhado. | E2, portas de comando/observação específicas. | Manutenção real com dados atuais e revisão de ações. |
| E8 / P2 | Integração de identidade, perfil, sessões, segurança e transporte de sync. | Serviço/provedor decidido e autorização de servidor. | Continuidade ponta a ponta entre duas sessões/dispositivos autorizados. |
| E9 / P2 | Hardware, rede, áudio e energia avançada; recuperação local por perfil. | Adapters e validação física específica. | Cada capacidade só aparece onde foi implementada e validada. |
| E10 / P3 | Nuvem de arquivos, planos, colaboração, políticas avançadas. | Decisões de produto e serviços próprios. | Fora da conclusão da etapa básica. |

E2 a E5 são incrementos independentes depois da base, não motivo para um PR monolítico. Não interromper a entrega dos recursos locais porque login, cloud ou hardware ainda dependem de decisões.

### 12.2 Backlog de correções imediatas

- [ ] Rótulo Ajustes consistente em rail, janela, busca e acessibilidade, mantendo `settings` como ID.
- [ ] Destino canônico de Atualizações em Sistema, com rodapé apontando para ele.
- [ ] Uma tradução/derivação compartilhada para fase, resultado e impacto de atualização.
- [ ] Revisar “Atualizado”, “Sincronização ativa” e “Operando normalmente” para exigir evidência suficiente.
- [ ] Distinguir recarga de interface, reinício da Surface, reinício do supervisor e reinício da máquina.
- [ ] Não vender `bootRefreshRequired` como garantia de atualização por simples reboot.
- [ ] Mover detalhes técnicos de capacidades para Diagnóstico.
- [ ] Remover marcadores temporários de investigação da mesa normal.
- [ ] Foco, scroll e formulário não são reiniciados por toda atualização de snapshot.
- [ ] Estado ausente, indisponível, offline e antigo são distintos.
- [ ] Preservar lifecycle e descarte de operações/respostas antigas.

### 12.3 O que falta para uma etapa básica útil

**Meta básica:** o usuário abre os quatro apps, entende limites reais, navega pelas seções entregues, personaliza o tema, realiza operações de arquivos suportadas, consulta versão/atualização/métricas, usa energia nativa confirmada e mantém estado entre recargas.

Para essa meta, faltam principalmente navegação interna uniforme; UX de dados reais; contratos/implementações de operações de arquivos; preferências além do tema; diagnóstico compreensível; e testes de ponta a ponta da Surface. Conta pode continuar sem provedor, desde que o estado seja honesto e o uso local não seja bloqueado.

**Não chamar de concluído:** login real sem provedor; cloud sem transporte e autorização; gerenciador de arquivos completo sem leitura/mutações; recuperação canônica sem gates; áudio/suspensão sem prova; instalação nativa baseada apenas em imagem conceitual.

### 12.4 Fora de escopo para não inflar esta etapa

- Loja de apps e package manager geral.
- Editor de texto/office completo; apenas visualização mínima e abertura por app podem integrar Arquivos.
- Assistente de IA obrigatório ou dependência de serviços pagos.
- Terminal/shell administrativo disfarçado de diagnóstico.
- Controle remoto genérico, comandos arbitrários ou novo plano de controle.
- Migração física de armazenamento, formatação de pendrive e instalação em SSD como efeito colateral de tela nova.
- Cobrança e nomes comerciais de planos não definidos.

## 13. Verificação e critérios de entrega

### 13.1 O que significa uma seção estar pronta

Uma seção está pronta quando tem dados/ações de um dono real, estados de sucesso/vazio/indisponibilidade/falha, persistência adequada, navegação e foco corretos, suporte aos dois temas, comportamento em janela pequena e testes proporcionais ao risco.

Uma captura bonita não prova integração. Teste unitário de contrato não prova fluxo visual. Teste Web não prova capacidade física Native. A entrega precisa indicar exatamente o que foi testado e o que continua pendente.

### 13.2 Cenários de aceite ponta a ponta

| ID | Cenário | Resultado esperado |
|---|---|---|
| NAV-01 | Abrir Sistema e clicar no estado de atualização do rodapé. | Uma única janela/destino Atualizações; nenhuma segunda central. |
| NAV-02 | Trocar subseção, minimizar, restaurar e recarregar. | Destino/foco/estado restaurados conforme contrato, sem duplicar listeners. |
| NAV-03 | Usar app em tela estreita e com teclado. | Navegação alcançável e retorno claro, sem três colunas ilegíveis. |
| FILE-01 | Abrir Documentos pela mesa, criar pasta e atualizar. | Mesmo local autorizado e pasta real, persistente. |
| FILE-02 | Criar nome inválido/duplicado e perder permissão. | Erro específico, preservação do contexto, nenhuma escrita fora da raiz. |
| FILE-03 | Ler arquivo desconhecido ou malformado. | Fallback seguro, sem execução ou falha da Surface. |
| FILE-04 | Copiar/mover com colisão, disco cheio ou interrupção. | Resultado parcial explícito; origem preservada até confirmação de destino. |
| FILE-05 | Excluir e restaurar via lixeira, quando entregue. | Conteúdo íntegro e conflitos tratados; remover favorito não apaga arquivo. |
| SET-01 | Trocar tema e recarregar em Web e Native com stores disponíveis. | Preferência preservada e todos os componentes coerentes. |
| SET-02 | Forçar falha de persistência. | UI não afirma “salvo”; valor não persistido é revertido ou claramente sinalizado. |
| SET-03 | Aumentar texto/reduzir movimento. | Interface continua operável, sem campos cortados. |
| ACC-01 | Abrir Conta na composição atual sem identity provider. | Indisponível honesto, sem perfil e login falsos. |
| ACC-02 | Alterar preferência offline com fila durável. | Pendência local sobrevive à recarga e não vira “sincronizado”. |
| ACC-03 | Quando houver provedor, trocar conta/revogar sessão. | Isolamento de perfil e fila; nenhuma transmissão para conta errada. |
| SYS-01 | Falhar leitura de métricas depois de sucesso. | Última leitura identificada como antiga; restante do app funciona. |
| SYS-02 | Simular atualização, falha, pin e rollback em fixture adequada. | Mesma semântica em rodapé/central; known-good preservado. |
| SYS-03 | Supervisor parado e telemetria de base ativa. | Não declarar supervisor saudável só pelo heartbeat da base. |
| SYS-04 | `bootRefreshRequired` sem base instalada. | Informação de pendência correta, sem promessa falsa de reboot resolutivo. |
| SYS-05 | Exportar diagnóstico com campos sensíveis de teste. | Redaction aplicada antes de disponibilizar o arquivo. |
| PWR-01 | Cancelar reinício e depois confirmar em alvo apropriado. | Cancelar não envia ação; confirmar usa serviço autorizado existente. |
| MODE-01 | Mesmo source em Web sem capacidades nativas. | Sem controle de disco/energia fictício e sem fork de tela. |
| SEC-01 | Nomes contendo HTML, Unicode, separadores e tentativas de escape. | Texto renderizado com segurança e fronteira de caminhos respeitada. |
| LIFE-01 | Abrir/fechar apps repetidamente e receber status atrasado. | Sem vazamentos, polling duplicado ou repaint de janela errada. |

Os cenários de funcionalidades futuras entram no incremento que as implementa; não marcar todos como aprovados por ter criado a estrutura de menus.

### 13.3 Testes/receitas existentes a preservar

Reusar a receita do repositório e selecionar testes por impacto. Exemplos observados na base:

```text
python tools/surface-web/build.py check
node --test tests/test_surface_preferences.mjs
node --test tests/test_surface_workspace.mjs
node --test tests/test_app_activation.mjs
node --test tests/test_app_contract.mjs
node --test tests/test_identity_session.mjs
node --test tests/test_identity_actions.mjs
node --test tests/test_account_runtime.mjs
node --test tests/test_power_actions.mjs
node --test tests/test_update_status.mjs
python -m unittest tests.test_surface_ui_contract -v
python -m unittest tests.test_surface_web_builder -v
python -m unittest tests.test_native_user_files -v
python -m unittest tests.test_native_system_metrics -v
python -m unittest tests.test_native_preferences -v
python -m unittest tests.test_hot_update_supervisor -v
```

Executar também os testes `test_sync_*.mjs` relevantes por caminhos explícitos ou pela receita CI compatível. Revalidar nomes/comandos na `main` antes de usar. Não exigir que o usuário final instale Python/Node; ferramentas de validação pertencem ao ambiente de desenvolvimento/CI.

Mudanças em contrato exigem regressões do contrato e consumers. Operações de arquivos precisam de teste de escape, symlink, concorrência, conflito e falha de escrita. Recursos físicos usam fixtures descartáveis primeiro e evidência física somente sob as regras do repositório.

### 13.4 Verificação visual e de integração

- Examinar claro/escuro, janela normal/maximizada, largura estreita e zoom de texto.
- Abrir cada seção pela navegação interna, pelo rail e pelos atalhos que apontam a ela.
- Testar vazio, sem capacidade, offline, erro e dados antigos; não somente caminho feliz.
- Recarregar a Surface e confirmar restauração, sem confundir refresh do navegador com reboot físico.
- Verificar ausência de dados de demonstração no runtime de produção; fixtures ficam em testes/previews identificados.
- Validar bundle determinístico pelo fluxo `surface-web-candidate` aplicável e demais verificações atingidas.
- Uma alteração visual não deve reconstruir kernel sem dependência real.

### 13.5 Modelo de relatório de entrega

```text
Incremento e objetivo:
Commit base / commit entregue:
Telas e destinos implementados:
Dados e ações reais usados:
Contratos criados/alterados e migração:
Persistência e tratamento de erros:
Testes executados e resultados:
Verificação visual e modos testados:
Limitações e capacidades ainda indisponíveis:
Validação física realizada ou pendente:
Escrita física realizada: NÃO, salvo autorização específica independente.
```

## 14. Instrução pronta para o GPT implementador

Copiar o bloco abaixo junto deste documento. Ele orienta uma implementação incremental; não autoriza operações físicas nem presume que toda integração externa já esteja disponível.

```text
Trabalhe no repositório prototipo-ordax-os usando a main atual como fonte de verdade.
Leia AGENTS.md e os documentos exigidos por ele antes de modificar código.
Use PLANO-FUNCIONAL-SURFACE-E-APPS.md, na raiz do repositorio, como proposta funcional detalhada.
Ela foi baseada no commit 4f1ea27d052ca75ff32807f3ee7578a3059b7707; compare com
a main atual e atualize o inventário antes de decidir o que falta.

Implemente os quatro apps da barra lateral — Arquivos, Ajustes, Conta e Sistema —
por incrementos verticais. Preserve IDs, a Surface compartilhada, os módulos
existentes, a identidade mineral/laranja e os adapters de capacidades.

Comece por E0/E1: destinos internos estáveis, nomenclatura, estado recuperável
e responsabilidade única. Atualizações, Armazenamento, Recuperação e Sobre
pertencem a Sistema. Ajustes cuida de experiência/preferências e integrações
locais; Conta cuida de identidade e continuidade; Arquivos cuida de conteúdo.

Continue com os incrementos locais E2-E5 conforme suas dependências. Reuse os
ports e serviços existentes. Complete Sistema > Visão geral conforme a ordem
e as fontes especificadas; ligue o rodapé à seção única de Atualizações.
Melhore Ajustes > Aparência sem inventar novas preferências não persistidas.
Evolua Arquivos por operações reais, sempre dentro da raiz autorizada.
Conta deve refletir indisponibilidade de provedor e sync local com honestidade.

Para cada seção: implemente conteúdo, ações, estados de carregamento/vazio/
indisponibilidade/erro/offline, persistência, foco, acessibilidade e responsividade.
Uma API observacional não autoriza comando. Não crie botões que simulam sucesso,
dados fictícios, providers falsos, contagens inventadas ou ações perigosas sem
backend e contrato. Controles futuros só aparecem ao completar o seu fluxo.

Antes de adicionar uma capacidade, documente dono, contrato, autorização,
concorrência, falhas, persistência, migração e testes. Não duplique telas por
plataforma. Não acople UI a provedor, shell ou caminhos físicos arbitrários.
Não trate telemetria como plano de controle ou como cadastro de conta.

Preserve atualização Git-first, pin/rollback, health acknowledgement e stores.
Não confunda desenvolvimento com release canônica assinada. Não altere bootstrap,
layout de mídia, confiança de release ou gates físicos para entregar interface.
Não escreva em disco físico, não formate, não instale nem reinicie a máquina do
usuário como efeito colateral deste trabalho de produto.

Execute validações proporcionais aos arquivos/contratos alterados, verifique
visualmente os fluxos e registre o que foi efetivamente testado. Atualize o
inventário e reporte cada incremento com pendências explícitas. Continue o
trabalho local independente quando integrações externas estiverem indisponíveis.
Não declare concluída uma seção que contém apenas a aparência do conceito.
```

## 15. Referências e decisões pendentes

### 15.1 Fontes do inventário

Todos os caminhos abaixo foram inspecionados em `origin/main` no commit de base. Os links de código usam o commit fixo para permitir conferir o inventário mesmo depois de novas mudanças.

| Assunto | Referência |
|---|---|
| Estado canônico e limites de prova | [CURRENT-STATE.md no commit analisado](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/docs/CURRENT-STATE.md) |
| Linguagem visual adotada | [DESKTOP-IDENTITY.md](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/docs/DESKTOP-IDENTITY.md) |
| Shell e atalhos atuais | [desktop-shell.mjs](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/system/surface/ui/desktop-shell.mjs) |
| Arquivos e operações expostas | [file-space-controls.mjs](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/system/surface/ui/file-space-controls.mjs) e [file-space.mjs](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/system/contracts/file-space.mjs) |
| Ajustes atuais | [settings-overview-controls.mjs](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/system/surface/ui/settings-overview-controls.mjs) |
| Conta e fila local | [account-overview-controls.mjs](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/system/surface/ui/account-overview-controls.mjs) |
| Identidade indisponível na composição observada | [identity.mjs](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/system/adapters/web/identity.mjs) e [composição Native](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/system/composition/native/main.mjs) |
| Visão de Sistema atual | [system-overview-controls.mjs](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/system/surface/ui/system-overview-controls.mjs) |
| Observação de atualizações | [update-status.mjs](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/system/contracts/update-status.mjs) e [update-controls.mjs](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/system/surface/ui/update-controls.mjs) |
| Métricas disponíveis | [system-metrics.mjs](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/system/contracts/system-metrics.mjs) |
| Telemetria e limites observacionais | [telemetry/README.md](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/system/services/telemetry/README.md) |
| Rescue delimitado | [rescue/README.md](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/4f1ea27d052ca75ff32807f3ee7578a3059b7707/system/rescue/README.md) |
| Contratos canônicos | [Diretório docs/contracts](https://github.com/washingtonmsdj/prototipo-ordax-os/tree/4f1ea27d052ca75ff32807f3ee7578a3059b7707/docs/contracts) |

Também foram consultados README, ARCHITECTURE, BUILD-AUTONOMY, PRODUCT-MODES, MINIMAL-USB-BOOTSTRAP, HOST-INDEPENDENCE, REMOTE-CONTROL, PHYSICAL-MEDIA, DEVELOPMENT-WORKFLOW, SOURCE-MIGRATION, PROMOTION-GATES, DECISIONS, ACCOUNT-SYNC-AND-PLANS e STORAGE-ARCHITECTURE. Este plano não reescreve sua autoridade.

### 15.2 Decisões necessárias antes dos respectivos incrementos

| Decisão | Quando precisa ser resolvida | Padrão proposto enquanto isso |
|---|---|---|
| Provedor/serviço de identidade e métodos de acesso | Antes de E8. | Identidade indisponível honesta; uso local permanece. |
| Transporte autenticado de sync e isolamento por conta | Antes do envio real. | Núcleo/fila locais; nenhum dado anunciado como enviado. |
| Lixeira, retenção e exclusão entre volumes | Antes de habilitar exclusão recuperável. | Não apresentar lixeira funcional sem backend. |
| Abertura/associação de tipos de arquivo | Antes de Abrir real. | Visualizadores mínimos seguros e fallback explícito. |
| Persistência de imagem de wallpaper | Antes de Escolher imagem. | Composição/papéis locais empacotados. |
| Fonte de tema automático e preferências do ambiente | Antes de Automático. | Claro/Escuro explícitos existentes. |
| Variações de cor da identidade | Antes da paleta. | Laranja conforme identidade adotada. |
| Escopo e preferência da telemetria observacional | Antes do editor de política de coleta. | Não inventar toggle; diagnosticar estado real e manter provider fora da UI. |
| Ações manuais do atualizador e condição de reboot | Antes de botões de comando. | Observação do fluxo existente e explicação do impacto conhecido. |
| Perfil físico e recuperação aplicáveis ao alvo | Antes de ação de recuperação/escrita. | Somente leitura e gates existentes; nada de migração implícita. |

Essas dependências não impedem a implementação das partes locais já sustentadas por contratos. O resultado deve evoluir de uma base funcional real para capacidades adicionais, mantendo cada pendência visível no planejamento e cada ação disponível sustentada pelo produto.
