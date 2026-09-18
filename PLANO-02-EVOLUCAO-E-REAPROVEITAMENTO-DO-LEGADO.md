# OrdaX — parte 2: evolução do protótipo e aproveitamento seletivo do legado

**Continuação de:** [PLANO-FUNCIONAL-SURFACE-E-APPS.md](PLANO-FUNCIONAL-SURFACE-E-APPS.md).

**Status:** análise comparativa de source, proposta de produto e roteiro de implementação. Não é autorização de migração física, adoção automática de código, promoção de release ou substituição dos contratos canônicos.

**Data da análise:** 18/09/2026.

| Repositório | Referência inspecionada | Papel nesta análise |
|---|---|---|
| `washingtonmsdj/novo-ordax-os` | `main` — `49fe41fa67d9032f2e349e86592304e64d6c2d88` | Origem de funcionalidades, experiências, invariantes e ideias a avaliar. |
| `washingtonmsdj/prototipo-ordax-os` | `main` — `640d7e86a155ad7e7f6c863f124ac5734b69b25b` | Base atual que deve ser preservada e ampliada. |
| Verificação complementar do protótipo | `main` — `cbb1257bb86f4b17276ea90b6a9fe636ef7e9dda` | Deltas recebidos durante a análise; avanços de atualização registrados na seção 3.2. |
| Parte 1 deste plano | Inventário em `4f1ea27d052ca75ff32807f3ee7578a3059b7707` | Especificação funcional dos quatro apps; continua válida como proposta, com estado factual a revalidar. |

**Instrução para o próximo GPT:** leia primeiro `AGENTS.md` e a documentação canônica indicada nele; depois leia as duas partes deste plano. Compare estes inventários datados com a `main` atual. Implemente uma entrega delimitada por vez, aproveitando os contratos existentes. Não comece copiando o repositório antigo.

## Sumário

1. [Conclusão da comparação](#1-conclusão-da-comparação)
2. [Método, evidência e limites](#2-método-evidência-e-limites)
3. [O que o protótipo já resolveu](#3-o-que-o-protótipo-já-resolveu)
4. [Matriz de lacunas e decisões](#4-matriz-de-lacunas-e-decisões)
5. [Especificação das próximas capacidades](#5-especificação-das-próximas-capacidades)
6. [Onde cada capacidade aparece na interface](#6-onde-cada-capacidade-aparece-na-interface)
7. [O que preservar e o que não transportar](#7-o-que-preservar-e-o-que-não-transportar)
8. [Sequência de implementação e dependências](#8-sequência-de-implementação-e-dependências)
9. [Contrato de entrega para o GPT implementador](#9-contrato-de-entrega-para-o-gpt-implementador)
10. [Inventário das ideias do legado](#10-inventário-das-ideias-do-legado)
11. [Fontes rastreáveis](#11-fontes-rastreáveis)

## 1. Conclusão da comparação

O protótipo já possui uma base mais alinhada ao objetivo de um produto compartilhado, simples de manter e independente da máquina de desenvolvimento. A maior falta não é reconstruir o antigo runtime: é transformar a base em jornadas completas de uso e, depois, recuperar seletivamente a visão de produto do `novo-ordax-os`.

Há três grupos de trabalho diferentes:

1. **Capacidades concretas encontradas no legado e ainda incompletas no protótipo:** operações de arquivos, gestão interativa de Wi-Fi, identidade/sessão local com bloqueio, projetos associados a workspaces, checkpoints de sessão, ferramentas de autoria de módulos, inventário de hardware e pareamento móvel limitado. A maturidade varia; algumas são implementações experimentais, não soluções prontas para produção.
2. **Ideias documentadas no legado que merecem sobreviver:** continuidade do trabalho, Home contextual, perfis profissionais, objetos com proveniência, IA com ferramentas e permissões explícitas, catálogo de apps/perfis/templates, inteligência do projeto baseada em evidências e cooperação entre dispositivos. A maioria ainda era visão ou especificação.
3. **Problemas que o protótipo já está resolvendo de outra maneira:** bootstrap mínimo, build reproduzível, uma Surface compartilhada, atualização cotidiana sem regravar USB, recuperação supervisionada e observabilidade. Transportar a implementação antiga inteira recriaria responsabilidades duplicadas.

**Prioridade recomendada:** completar Arquivos, a organização das telas e os estados reais; entregar rede e continuidade local; completar identidade e sincronização entre dispositivos; ampliar os modos Mobile/Desktop e a distribuição canônica; somente então abrir apps instaláveis, perfis e IA. As trilhas de confiabilidade física e de UX podem avançar separadamente, sem bloquear recursos locais por ausência de cloud.

Este segundo documento amplia o horizonte. Não aumenta automaticamente o escopo da primeira etapa da sidebar. Store, IA, navegador, instalação e federação continuam fora da conclusão básica dos quatro apps.

## 2. Método, evidência e limites

### 2.1 O que foi confrontado

A análise consultou as referências remotas por Git, leu o source do protótipo e examinou uma referência isolada do legado, sem importar sua árvore para o produto. Foram comparados documentação de estado, contratos, implementações representativas, testes existentes, registros de ideias e relatórios versionados.

As fontes do legado estão fixadas no SHA acima, por links no final. As referências locais ao protótipo apontam para arquivos que evoluem na `main`; use o SHA da tabela para reproduzir este inventário. A leitura foi orientada por capacidades: não constitui auditoria de todas as linhas dos dois repositórios.

**Não foram executados nesta análise:** testes antigos, builds do legado, aplicativos móveis, serviços cloud, comandos no notebook, instalações, migrações de disco ou provas físicas. Um relatório antigo dizendo PASS é evidência histórica do cenário descrito, não uma nova certificação feita aqui.

### 2.2 Classificação usada

| Marca | Significado |
|---|---|
| CÓDIGO | Implementação concreta encontrada; integração, segurança e suporte precisam de avaliação própria. |
| PARCIAL | Parte do fluxo existe, mas falta completar experiência, backend, contrato, distribuição ou prova. |
| VISÃO | Ideia, contrato futuro ou arquitetura documentada; não equivale a implementação. |
| RELATO | Resultado de teste/prova registrado no repositório; não reexecutado nesta análise. |
| NÃO LOCALIZADO | Não encontrado nos fluxos e fontes examinados. Não é prova absoluta de inexistência em todo o histórico. |
| PRESERVAR | Evoluir a solução do protótipo, evitando outro owner para a mesma função. |
| REIMPLEMENTAR | Extrair o comportamento útil e implementá-lo nos contratos do protótipo. É recomendação, não migração concluída. |
| ADIAR | Reter a ideia com condições de entrada claras. |
| REJEITAR | Não trazer a estrutura ou acoplamento indicado. Não significa descartar todo o aprendizado. |

P0 indica integridade e clareza da base; P1, experiência cotidiana; P2, continuidade/distribuição e expansão controlada; P3, visão avançada. Prioridade não autoriza operação física nem elimina dependências.

### 2.3 Cuidados com a interpretação do legado

- Os módulos `ordax.ai` e `ordax.store` têm `state: planned`, versão `0.0.0` e `entrypoint: null`; Browser e Cloud também se declaram não implementados. Seus diretórios não provam produtos funcionando. [L05]
- O SDK v0 gera e valida módulos e instala em uma árvore de rootfs; sua própria documentação exclui assinatura, publicação na Store e instalação oficial transacional. [L12]
- Login e bloqueio locais têm código de **preview**, inclusive autenticação simplificada. Não são uma base de autenticação de produção a copiar. [L08]
- O mobile observado implementa pareamento Companion, não toda a experiência OrdaX Mobile. [L13]
- A Home nova do legado está em fundação isolada, com integração indicada como HOLD; suas intenções não são um executor geral. [L14]
- `NEXT-QUEUE.md` se declara superseded. Filas antigas não definem a prioridade do protótipo. [L04]
- Documentos de Intelligence, Federation e perfis contêm ideias importantes, mas explicitam limites de implementação. [L15] [L16] [L17] [L19]

## 3. O que o protótipo já resolveu

### 3.1 Não reiniciar estas fundações

| Fundação atual | Evidência no protótipo | Como continuar |
|---|---|---|
| Uma Surface e quatro apps próprios | `system/surface/`, `system/apps/`, catálogo e ativação compartilhados. | Completar jornadas e contratos, sem criar outro desktop. |
| Áreas, janelas e restauração local | `system/contracts/workspace-store.mjs` e adapters Web/Native. | Separar área visual, workspace de trabalho e sessão. |
| Preferências e tema | Catálogo/serviços e stores Web/Native. | Adicionar preferências justificadas ao owner existente. |
| Núcleo de sync offline | `system/services/sync/`, contratos e stores duráveis. | Conectar identidade/transporte e validar reconciliação real. Não reconstruir a fila. |
| Arquivos limitados a uma raiz | Porta `ordax.file-space/1`, adapter Native. | Acrescentar uma operação tipada por vez; hoje o contrato exige `list` e `createDirectory`. |
| Métricas e energia nativa | Contratos `system-metrics` e `power-actions`. | Ampliar dados com origem e validade; não simular sensores ausentes. |
| Atualização Git-first | Entrypoint, supervisor, watcher e status de atualização. | Preservar recarga/restart seletivos e separar checkout de runtime efetivo. |
| Recuperação autônoma limitada | Guardian e canal Git de rescue, documentados no estado atual. | Completar ensaios pendentes; não substituir por shell remoto. |
| Observabilidade operacional | Telemetria de base, supervisor e heartbeat da Surface. | Agregar diagnóstico compreensível sem confundir sinais. |
| Build e bundles reproduzíveis | Receitas, ambiente fixado, contratos e CI. | Expandir a produtos afetados; evitar dependência de toolchain local. |
| Release acquisition e Creator Core | Verificação, materialização, planos e implementação RAW interna isolada. | Fechar trust/gates e integração de produto antes de distribuição física pública. |

Fontes centrais: [estado atual](docs/CURRENT-STATE.md), [modos](docs/PRODUCT-MODES.md), [autonomia](docs/BUILD-AUTONOMY.md), [contratos](system/contracts/README.md) e [primeira parte](PLANO-FUNCIONAL-SURFACE-E-APPS.md).

### 3.2 Avanços posteriores ao inventário da parte 1

Até a base `640d7e8`, o código distingue melhor o SHA do checkout e o runtime efetivo, envia heartbeat da Surface e vincula a confirmação de saúde ao SHA efetivamente carregado pela interface. Ver [watcher](system/adapters/native/update-runtime.mjs), [heartbeat](system/adapters/native/surface-heartbeat.mjs) e o host nativo.

Portanto, a próxima implementação deve **consumir e preservar esses sinais**, não criar outra solução para detectar versão antiga. Ainda é preciso apresentar isso corretamente em Sistema e verificar o fluxo completo. Um heartbeat da base não comprova que a UI renderizou o candidato; um SHA no Git não comprova que todos os processos já o executam.

O estado canônico registra provas físicas no USB de desenvolvimento para gráficos, entrada, energia, atualização ao vivo, guardian, rescue e telemetria. Também deixa separados o ensaio físico de candidato propositalmente quebrado, a continuidade de certas mutações pendentes após restart e os gates canônicos de instalação/release. **Não classificar o protótipo inteiro como “só mock”; também não classificá-lo como OS canônico concluído.**

**Verificação complementar até `57e730c`:** o delta de source acrescenta tratamento de Markdown como mudança neutra para o runtime; recuperação limitada de heartbeat antigo/incompatível da Surface; preflight conforme o tipo de aplicação; preparação de candidato em diretório separado antes da troca do checkout; e métricas internas de duração de preparação/aplicação. Esses comportamentos aparecem no [supervisor](system/supervisor), no [host nativo](system/surface/runtime/native_host_server.py) e em testes versionados. A análise conferiu o código e as asserções, sem executar esses testes ou repetir prova física.

Preservar também esses avanços. Preparar uma árvore fora do checkout não comprova, por si só, que todos os processos executam a partir de slots imutáveis com ativação A/B completa. Métricas internas não significam automaticamente que a porta pública/UI já as disponibiliza. Essa verificação complementar não encontrou alteração no escopo dos contratos de arquivos, conta, sync, Mobile ou Desktop inventariados acima.

**Ajuste final em `cbb1257`:** o caminho de `reload` passou a usar os objetos Git já adquiridos como preparação leve, sem materializar uma árvore completa de release. A preparação em diretório separado continua para os modos aplicáveis de restart. Portanto, não exigir um slot materializado para toda atualização visual; preservar a classificação e os testes existentes por tipo de mudança.

### 3.3 Armazenamento: arquitetura adotada não é mídia migrada

[STORAGE-ARCHITECTURE.md](docs/STORAGE-ARCHITECTURE.md) e [storage-architecture.json](docs/contracts/storage-architecture.json) já registram uma direção durável distinta para Native e USB portátil. O alvo Native usa pool compartilhado com Btrfs/LUKS2; o USB portátil usa volume de dados e imagens de sistema/estado com semânticas diferentes.

Isso convive com contratos de seed, mídia preparada e provas transitórias. **Não transformar a comparação com o legado em uma nova decisão de particionamento.** Identificar o artefato e o perfil exatos, conferir os contratos correspondentes e resolver discrepâncias documentais antes de qualquer mudança de layout. A antiga divisão física PLATFORM/HOME não deve voltar por cópia de scripts.

## 4. Matriz de lacunas e decisões

Esta matriz dá a visão geral. A seção 5 detalha o que entregar; a seção 6 define onde aparece. “Falta” refere-se ao recorte examinado na base registrada.

| ID | Capacidade do legado/ideia | Evidência e maturidade | Situação do protótipo / lacuna | Direção |
|---|---|---|---|---|
| C01 | Arquivos: criar, copiar, renomear | CÓDIGO + testes de colisão, falha e confinamento. [L06] | Listar/criar pasta; faltam leitura e mutações restantes. | REIMPLEMENTAR P1. |
| C02 | Rede/Wi-Fi de uso cotidiano | CÓDIGO para scan, conexão, credenciais e reconexão; RELATOS limitados de hardware. [L07] [L03] | Rede de bootstrap funciona; falta jornada compartilhada de configuração. | REIMPLEMENTAR P1 por capacidade. |
| C03 | Sessão local, login, lock/unlock | CÓDIGO de preview; preservação de sessão. [L08] | Modelo de conta não é login local nem bloqueio do OS. | REIMPLEMENTAR P1/P2 com autenticação apropriada. |
| C04 | Workspace e projeto | CÓDIGO para abrir/fechar/inspecionar projetos e workspaces. [L09] | Áreas/janelas e metadados existem; contexto de projeto incompleto. | REIMPLEMENTAR P1 incremental. |
| C05 | Checkpoint de sessão | CÓDIGO de criação/restauração de registros. [L10] | Geometria restaurada não garante retomada de conteúdo. | REIMPLEMENTAR P2. |
| C06 | Home contextual / continuar trabalho | CÓDIGO isolado + VISÃO de produto. [L14] [L18] | Shell existe; faltam fontes de recentes/pendências/contexto. | REIMPLEMENTAR P1/P2 sem outro shell. |
| C07 | Inventário e suporte de hardware | CÓDIGO GDEF e suporte Realtek; RELATO específico. [L11] [L03] | Métricas básicas; faltam inventário, compatibilidade e UI operacional. | REIMPLEMENTAR P1/P2 sob adapters. |
| C08 | Conta e identidade entre modos | VISÃO; identidade local e serviços separados não são conta universal pronta. [L08] [L18] | Contratos e estados existem; adapters de conta examinados indisponíveis. | COMPLETAR P2 no modelo atual. |
| C09 | Sync e continuidade cloud | VISÃO Cloud + fluxos específicos de backend; módulo Cloud planejado. [L05] | Core offline existe; falta transporte autenticado/serviço de produto. | PRESERVAR core; COMPLETAR P2. |
| C10 | Mobile Companion e pareamento | CÓDIGO Expo, desafio/código e armazenamento seguro. [L13] | Adapter Mobile é fronteira documentada. | REIMPLEMENTAR P2, após conta. |
| C11 | Desktop instalado e Creator | VISÃO de experiência/tooling do legado. | Fronteira Desktop e Creator Core existem; produto Desktop pendente. | IMPLEMENTAR P2 no desenho do protótipo. |
| C12 | Apps instaláveis e SDK | CÓDIGO SDK v0, runtime/pacotes e contratos antigos. [L12] [L22] | Catálogo first-party existe; não é gerenciador de pacotes geral. | REIMPLEMENTAR P2, validar um app externo. |
| C13 | Store e distribuição de conteúdo | VISÃO; módulo sem entrypoint. [L05] [L20] | Não localizado produto Store. | ADIAR P3 até ciclo de app seguro. |
| C14 | Perfis profissionais | VISÃO explicitamente conceitual. [L19] | Sem perfil de produto; áreas não equivalem a perfis. | ADIAR P3; começar com um perfil opcional. |
| C15 | Objetos com proveniência | VISÃO, sem schema/API operacional naquela especificação. [L21] | Arquivos e metadados não compõem ainda modelo de objetos. | ADIAR P3; experimentar caso pequeno. |
| C16 | IA nativa, contexto e ferramentas | VISÃO; `ordax.ai` planejado. [L05] [L17] | Não localizada camada de IA de produto. | ADIAR P3; consulta antes de execução. |
| C17 | Conhecimento, integrações e automações | VISÃO de Intelligence. [L16] [L17] | Não localizados fluxos de produto completos. | ADIAR P3; opt-in e permissões por operação. |
| C18 | Diagnóstico, recibos e captura visual | CÓDIGO/RELATOS de captura e arquivo privado. [L23] | Telemetria existe; faltam painel local e exportação revisável. | P1/P2 local; captura remota opcional posterior. |
| C19 | Controle remoto/Companion | CÓDIGO especializado e arquitetura própria do legado. [L13] [L23] | Rescue limitado e observação já existem; não são controle geral. | ADIAR capacidades extras até requisito concreto. |
| C20 | Atualização transacional e rollback | CÓDIGO de activation/trust/update. [L22] | Git-first e release acquisition existem, com gates distintos. | PRESERVAR P0; completar provas e release. |
| C21 | Instalação Native e armazenamento durável | CÓDIGO/arquiteturas legadas acopladas ao layout antigo. [L01] [L02] | Arquitetura nova adotada; migração/produto canônico incompletos. | IMPLEMENTAR P2 conforme contratos atuais. |
| C22 | Build Intelligence, cache, retenção | CÓDIGO/RELATOS para partes; VISÃO para inteligência. [L03] [L24] | Autonomia, receitas e CI já existem. | PRESERVAR; otimizar só com medição. |
| C23 | Project Intelligence / Mission Control | VISÃO explicitamente planejada e observacional. [L24] | Evidências existem; painel agregado não equivale a autoridade. | ADIAR P3 ou relatório estático pequeno. |
| C24 | Federação, Research Lab e agentes de engenharia | VISÃO arquitetural sem implementação na fundação. [L25] [L16] | Não necessária ao bootstrap/produto básico. | ADIAR P3. |
| C25 | Navegador e produtividade | Browser planejado; jornadas sugerem ferramentas, não apps completos. [L05] [L18] | Não localizado navegador/office/editor de produto completo. | ADIAR; primeiro visualizar/abrir arquivos. |
| C26 | Notificações, acessibilidade e onboarding | Jornadas e requisitos; não comprovados como stack pronta no legado. [L18] | Necessidades detalhadas na parte 1; integração ainda parcial. | IMPLEMENTAR P1 por contratos do protótipo. |
| C27 | Backup e histórico de dados pessoais | VISÃO de continuidade; checkpoint/rollback não bastam. [L10] [L18] | Não localizado serviço completo de backup do usuário. | IMPLEMENTAR P2 separado de rollback do sistema. |

## 5. Especificação das próximas capacidades

Os nomes de operações sugeridos nesta seção descrevem contratos a discutir; **não são APIs já disponíveis**. Cada entrega deve adaptar o modelo existente, versionar contratos quando necessário e declarar capacidades indisponíveis por ambiente.

### 5.1 C01 — Arquivos que permitem trabalhar

**Origem e lacuna:** o Explorer antigo implementa criação de pasta, cópia de arquivo regular e renomeação com bloqueios, validação de nomes, rejeição de colisão e proteção da raiz. Os testes incluem falta de espaço, erro de escrita, arquivo grande e corrida de destino. Isso é mais do que o contrato atual de listagem/criação de pasta. Não demonstra lixeira, cópia recursiva ilimitada, transferência cloud ou editor completo. [L06]

**Entrega mínima em incrementos:**

1. Seleção, detalhes, navegação por teclado e leitura segura de arquivo suportado; integração “Abrir com” somente para apps realmente disponíveis. **Estado atual:** seleção única, painel de detalhes, setas/Home/End/Enter, segundo clique/ação explícita e visualização segura UTF-8 de até 256 KB estão implementados no Native; “Abrir com” continua pendente até existir app compatível real.
2. Renomear arquivo/pasta, com validação consistente no cliente e no owner da operação. **Estado atual:** implementado no `ordax.file-space/4`, com rename atômico sem sobrescrita, rejeição de symlink/colisão, formulário contextual e regressões de preservação de origem/destino.
3. Copiar arquivo com limite explícito, conflito de nome e resultado persistido; depois ampliar para múltiplos itens/diretórios se houver necessidade. **Estado atual:** cópia de arquivo regular na mesma pasta está implementada com limite de 64 MiB, destino no-clobber, streaming, `fsync` do conteúdo e do diretório e remoção automática de destino parcial em falha; escolha de outra pasta, diretórios e múltiplos itens continuam pendentes.
4. Importar/exportar conforme o ambiente; transferência sem permissões de host indevidas.
5. Mover e lixeira após definir recuperação, retenção e semântica entre volumes. Não disfarçar exclusão permanente como lixeira.

**Interface:** manter Arquivos como owner. Barra de ações contextual, seleção visível, breadcrumbs, progresso para operação longa, erro junto do item e acesso a detalhes. Origem/destino devem ser claros antes de sobrescrita; cancelar não pode deixar um arquivo parcial parecendo concluído.

**Contrato/dados:** caminho lógico ou handle limitado à raiz, identificação da operação, resultado estruturado, limites de tamanho e semântica de conflito. Validar caminhos também no backend. Preservar original até confirmar destino; definir comportamento para symlinks, links quebrados e desmontagem durante a operação. Não copiar limites experimentais do legado sem justificativa.

**Aceite:** copiar mantém conteúdo e original; colisão não altera arquivo de terceiro; renomear preserva conteúdo; falta de espaço/falha/cancelamento não publica destino incompleto; caminho malicioso não escapa da raiz; recarga apresenta estado real. Criar casos novos no protótipo inspirados nas invariantes antigas. **Relação com parte 1:** E4 e E6.

### 5.2 C02 — Rede e Wi-Fi utilizáveis pela interface

**Origem:** o legado tem scan, associação, DHCP, status, redes salvas, remoção e reconexão. Há relatos específicos de Realtek e de persistência após reboot. Isso não prova suporte universal nem garante que o protótipo precise dos mesmos drivers. [L07] [L03]

**MVP:** em **Ajustes → Rede**, mostrar adaptadores, estado da conexão, rede atual, força do sinal quando medida e redes encontradas. Permitir conectar, desconectar e esquecer quando suportado. Diferenciar “sem adaptador”, “Wi-Fi desligado”, “procurando”, “senha rejeitada”, “associado sem IP”, “rede local sem internet” e “conectado”.

**Redes salvas:** consentimento para salvar credencial, reconexão previsível e remoção real do segredo. Senhas ficam no armazenamento apropriado do dispositivo; não em preferências sincronizadas, URL, logs ou pacote de diagnóstico. Uma falha não deve apagar silenciosamente a rede funcional anterior.

**Arquitetura:** porta de rede neutra para UI; adapter nativo controla o serviço real. Web informa conectividade disponível pelo ambiente, sem prometer scan de Wi-Fi do host. Não criar uma rede para boot e outra concorrente para a Surface: separar fases e compartilhar um owner definido para o estado efetivo.

**Aceite:** rede correta/senha errada/SSID ausente/perda e retorno de sinal; reconexão após reboot autorizado; esquecer impede uso posterior da credencial; nenhum segredo em logs; UI responde quando backend falha. Identificar hardware/driver exato de cada prova. **Parte 1:** E9, podendo antecipar conectividade cotidiana antes das demais funções avançadas de hardware.

### 5.3 C03 — Identidade local, sessão e bloqueio

**Origem:** Identity/Session/Lock do legado preservam referência de sessão, mas a autenticação observada é de preview. Extrair a separação de responsabilidades, nunca a credencial padrão ou seu mecanismo simplificado. [L08] [L10]

**Definir antes de implementar:** quem é o usuário local no USB/Native, como autentica offline, como isso se relaciona com a conta OrdaX e como recuperar acesso. Usuário local, conta cloud, dispositivo e sessão são entidades diferentes. Logout da conta não deve apagar automaticamente os arquivos locais nem desligar o OS.

**MVP:** sessão local explícita e bloqueio/desbloqueio nativo com mecanismo de autenticação adequado. Bloquear preserva apps/áreas e impede acesso à sessão protegida; desbloquear retoma o mesmo contexto. Política de inatividade fica em Ajustes; informações da sessão vinculada ficam em Conta.

**Limites por modo:** bloquear a Surface Web não equivale a bloquear Windows/Linux nem impede inspeção pelo dono do navegador. Explicar o alcance; usar APIs de host apenas em adapters autorizados. Biometria móvel é um desbloqueio local de sessão/segredo, não outro sistema de conta.

**Aceite:** lock mantém trabalho; tentativa inválida não abre sessão; reinício não contorna política definida; logout revoga apenas o escopo certo; troca de usuário não revela estado privado anterior. Segurança precisa de testes do mecanismo, não só da tela. Multiusuário amplo pode ser posterior. **Parte 1:** Conta → Segurança/Sessões e Ajustes → Privacidade/Comportamento, conforme subseções realmente entregues.

### 5.4 C04 — Workspace de trabalho e projetos

**Origem:** o legado tem operações de projeto, dependências, runtime e associação a workspace. O protótipo já tem áreas visuais/janelas; não apagar essa solução para introduzir o conceito novo. [L09]

**Distinção:** área organiza janelas; workspace organiza um contexto de trabalho; projeto representa uma atividade com conteúdo e metadados próprios. Um projeto pode abrir em uma área sem exigir três hierarquias novas na navegação.

**MVP:** criar/abrir projeto com nome, pasta escolhida ou referência lógica, última atividade e apps associados; reabrir sem perder vínculo. Começar com projeto genérico ou de desenvolvimento, não com dez verticais. Pasta inacessível deve produzir “local indisponível”, sem apagar projeto.

**UX:** entrada em Arquivos/Projetos e atalho “Continuar” na Home. Detalhes revelam localização, apps usados e estado de disponibilidade. Criar projeto deve explicar o que é metadado e o que será criado na pasta.

**Persistência:** IDs estáveis, versão do schema, fontes de conteúdo e metadados portáveis. Caminhos absolutos, credenciais e geometria física não sincronizam como referências universais. Em outro dispositivo, oferecer selecionar local ou baixar conteúdo autorizado.

**Aceite:** fechar/reabrir mantém identidade do projeto; renomear não duplica registros; remover dos recentes não apaga arquivos; dispositivo sem conteúdo mostra pendência honesta; nenhuma execução de script de projeto apenas por abri-lo. **Parte 1:** amplia E4/E6 e a continuidade da mesa.

### 5.5 C05 — Retomar trabalho e checkpoints

**Origem:** o legado possui registros de checkpoint com hash e restauração. Isso não comprova hibernação de processos nem recuperação de todo documento não salvo. [L10]

**MVP:** cada app declara um estado serializável pequeno e seguro: rota interna, referência de documento, posição de leitura e rascunho quando houver um editor com persistência própria. O shell restaura layout usando o modelo atual; não tenta serializar DOM, processos ou segredos.

**Jornada:** após recarga ou restart da Surface, reabrir o trabalho recuperável; se houve falha, indicar o ponto recuperado e o que não pôde ser restaurado. Um checkpoint novo só substitui o anterior depois de gravado e validado. Retenção deve ser limitada.

**Compatibilidade:** versão por app/estado, migração testável, descarte controlado de campo inválido e recuperação sem loop de abertura de app quebrado. Em sync, transportar somente a parte permitida; segredo de dispositivo e handle de host permanecem locais.

**Aceite:** fechamento inesperado, estado truncado, versão anterior e app removido; conteúdo realmente salvo reaparece; app indisponível não trava shell; nenhum “Tudo restaurado” se faltaram itens. **Parte 1:** E1/E5/E8.

### 5.6 C06 — Home contextual e identidade própria

**Origem:** Experience Book propõe continuar o trabalho; Home isolada separa modelo, layout, fonte e intenção. É uma boa referência de responsabilidades, não um renderer a transportar. A integração do legado estava em HOLD. [L14] [L18]

**MVP de conteúdo real:** uma entrada discreta para continuar projetos/documentos disponíveis, pendências acionáveis e atalhos usados. A composição muda conforme o estado: primeiro uso oferece ações de início; uso recorrente prioriza continuidade; falha de sync aparece como pendência localizada.

**Direção visual:** aproveitar o design do protótipo e dar hierarquia às tarefas. Evitar preencher a tela inicial com cartões repetidos de CPU/RAM, slogans, gráficos sem decisão ou assistente de IA fictício. Os dados técnicos completos pertencem a Sistema. IA só ocupa espaço se existir, tiver utilidade e puder ser desativada.

**Regra de fonte única:** recentes vêm do histórico autorizado de uso; pendências vêm dos owners de arquivos/sync/update; apps vêm do catálogo real. A Home apenas apresenta e encaminha. Não implementa um segundo gerenciador de arquivos, updater ou mecanismo de permissões.

**Aceite:** ações abrem o destino correto e preservam seleção; dados antigos são identificados; limpar histórico funciona; item removido não reaparece por cache; carregamento de recomendação não bloqueia desktop. Conteúdo sensível não aparece na tela bloqueada. **Parte 1:** evolução da mesa após E1/E4/E5.

### 5.7 C07 — Hardware, periféricos e compatibilidade

**Origem:** o GDEF antigo separa descoberta, matching, drivers, firmware, registry e support packs; inclui uma prova específica de rede Realtek. Preservar a ideia de compatibilidade rastreável, sem transformar um dispositivo certificado em promessa para todo USB/Wi-Fi. [L11] [L03]

**MVP observacional:** em **Sistema → Hardware**, listar componentes detectados, estado, identificador técnico quando útil, driver ativo e limitações conhecidas. Em **Ajustes**, oferecer configurações efetivas de Tela, Áudio, Entrada e Rede conforme adapters disponíveis. Inventário não é autorização para instalar driver.

**Próximos controles:** volume/mudo/saída, resolução/escala quando suportada, layout de teclado, ponteiro e estado de bateria. Suspensão, Bluetooth, impressoras e múltiplas telas exigem integrações e provas próprias; não incluir toggles vazios para “completar” a tela.

**Suporte distribuído:** pacote de driver/firmware tem origem, licença, compatibilidade com kernel/arquitetura, hash, política de instalação e retorno ao estado anterior. A escolha deve ser verificável e não depender de IA. Drivers não sincronizam com a conta do usuário.

**Aceite:** hotplug, dispositivo desconhecido, driver ausente e reconexão; Web apresenta apenas informações que consegue obter; prova de áudio mede saída real, não só valor de slider; falha de periférico não impede shell. **Parte 1:** E9.

### 5.8 C08 — Conta de produto e dispositivos vinculados

**Estado atual:** contratos de sessão/ações e runtime de conta já existem, mas os adapters examinados não oferecem autenticação de produto disponível. Telemetria do notebook e chaves de manutenção não substituem uma conta OrdaX.

**MVP:** selecionar serviço/provedor, definir identidade estável, entrar/sair, recuperar acesso e consultar sessão atual. Em **Conta → Visão geral**, mostrar identidade somente depois de validada; em Perfil, editar campos com suporte real; em Segurança/Sessões, expor sessões/dispositivos vinculados e revogação efetiva.

**Servidor:** validar autorização por usuário/recurso em toda operação, expiração e revogação. UI escondida não é política de acesso. Armazenamento local de credenciais deve respeitar o modo; nenhum token em workspace metadata, logs ou arquivo exportado.

**Dispositivos:** nome amigável, modo, última atividade com validade, sessão atual e capacidade de revogar vínculo. “Último contato há X” é mais correto que “Online” quando não há sinal recente confiável. Periféricos ficam em Ajustes; os devices da conta não são mouse/teclado.

**Offline:** manter uso local quando permitido e explicar ações que exigem rede. Sessão expirada não deve destruir rascunhos; operações pendentes aguardam reautenticação, respeitando a identidade original. Contas diferentes no mesmo cliente devem ter stores isolados.

**Aceite:** login, logout, expiração, revogação remota e troca de conta; usuário A não acessa dados de B por alteração de ID; estado da conta não persiste indevidamente na UI após sair. **Parte 1:** E5/E8. A escolha de provedor não está determinada pelo uso atual de um relay de telemetria.

### 5.9 C09 — Sync real entre dois dispositivos

**Preservar:** fila, revisões, conflitos, classificação de dados e stores existentes. O gap principal é ligar esse núcleo a uma identidade e a um transporte autorizado, e provar a jornada ponta a ponta. [Modelo de sync](docs/contracts/sync-model.json), [política de conta](docs/ACCOUNT-SYNC-AND-PLANS.md).

**Primeira entrega:** sincronizar um conjunto pequeno de preferências e metadados de workspace. Não iniciar por upload automático de todo o diretório pessoal. Conteúdo de arquivos requer seleção, quotas, integridade, progresso e regras próprias.

**Conta → Sincronização:** tipos habilitados, última conclusão real, alterações locais pendentes, erro sanitizado, conflitos e ação de tentar novamente quando suportada. “Salvo neste dispositivo” e “Sincronizado com a conta” devem ser mensagens diferentes.

**Conflitos:** política por tipo de dado; revisão de base e mutações idempotentes. Preferência simples pode ter regra determinística; documento com edições divergentes precisa preservar versões ou permitir resolução. Não aplicar last-write-wins universalmente. Exclusões precisam de semântica e retenção compatíveis com clientes offline.

**Aceite:** dois clientes da mesma conta, edição offline concorrente, reconexão, repetição de envio, reinício do cliente e troca de usuário. Nenhuma perda silenciosa, vazamento entre contas ou duplicação de operação. “Pausa” interrompe novos envios conforme contrato, não apaga pendências. **Parte 1:** E8, antes de E10.

### 5.10 C10 — Mobile e pareamento

**Origem concreta:** o mobile antigo usa QR/código de desafio, login, confirmação entre dispositivos, armazenamento seguro e estados de expiração/revogação. O escopo observado é Companion de acesso limitado. Não transportar uma segunda árvore de app para reproduzir esse caso. [L13]

**MVP do modo Mobile:** empacotar o produto compartilhado com navegação apropriada ao toque; identidade e preferências comuns; picker de arquivos/mídia e secure storage por adapter; funcionamento offline para dados permitidos. Android/iOS não recebem autoridade RAW, chaves de release ou shell privilegiado.

**Pareamento opcional:** “Adicionar dispositivo” em Conta abre desafio de uso único e duração limitada; os dois lados exibem o mesmo destino e o escopo solicitado. Confirmar o vínculo deve mostrar o que será compartilhado. Expiração, cancelamento e revogação retiram a possibilidade de usar o desafio.

**Companion:** começar com consulta de estado autorizada. Controlar outro dispositivo, captar sua tela e transferir arquivos são permissões distintas; não podem nascer implicitamente do pareamento. Registrar uso e permitir revogação independente.

**Aceite:** código errado/expirado/reutilizado, usuário diferente, dois dispositivos competindo pelo mesmo desafio, app encerrado e revogação. Segredo fica no storage nativo adequado. Prova real em cada plataforma suportada; mock de câmera não comprova QR no aparelho. **Dependências:** C08; C09 para continuidade; contratos do [adapter Mobile](system/adapters/mobile/README.md).

### 5.11 C11 — Desktop instalado e Creator integrado

O protótipo já definiu o [limite Desktop](system/adapters/desktop/README.md): shell fino, produto compartilhado, APIs nativas restritas e privilégio separado. Implementar essa fronteira, sem adotar toda a engenharia remota do legado.

**MVP Desktop:** instalar/abrir/desinstalar como aplicativo normal, restaurar preferências, abrir/salvar arquivos escolhidos pelo usuário, indicar versão do cliente e aplicar seu canal de atualização assinado. Background, notificações e links externos só quando efetivamente suportados.

**Creator dentro do produto:** entrada em Sistema com capacidade “Criar mídia OrdaX”. Fluxo usa artefatos pré-construídos verificados, seleção inequívoca do dispositivo, plano/dry-run, resumo do que será apagado/criado, autorização específica, progresso e leitura posterior. Não expor handles RAW à Surface.

**Canais separados:** atualizar o aplicativo Windows não instala o OS no SSD nem atualiza um pendrive. Baixar release OrdaX não autoriza escrevê-la. A arquitetura física, os gates de trust e o contrato de autorização continuam governando o Creator.

**Aceite:** operações comuns sem elevação; permissão negada mantém aplicativo utilizável; helper recusa operações fora da lista; troca/remoção do alvo invalida autorização; atualização do cliente tem integridade e recuperação testadas. A liberação de escrita física pública continua uma entrega própria. **Parte 1:** capacidades por modo, sem incluir instalação na conclusão dos quatro apps.

### 5.12 C12 — Apps, permissões e SDK

**Origem:** SDK v0 tem scaffolding, validação e instalação em rootfs; bibliotecas de package/runtime existem. As interfaces dependem da organização antiga. Usar a disciplina de manifesto/API pública como referência e desenhar a extensão do [catálogo atual](system/apps/catalog.mjs). [L12] [L22]

**Primeiro caso:** um app adicional pequeno, versionado e removível, sem privilégio. Validar o ciclo antes de abrir um marketplace: descobrir, verificar compatibilidade, instalar, iniciar, persistir estado, atualizar, reverter falha e remover preservando dados conforme opção do usuário.

**Manifesto mínimo proposto:** ID, versão, entrypoint, modos suportados, contratos requeridos, capacidades/permissões, origem/editor, hash e assinatura quando aplicável. App não recebe acesso ao dispositivo só porque foi listado no catálogo.

**Permissões:** por recurso/ação e duração quando relevante; escopo legível ao usuário. Mudança de permissões em atualização deve ser perceptível e tratada pela política. Remover uma permissão impede novas operações no owner, não apenas esconde botão.

**SDK novo:** exemplos alinhados ao runtime escolhido, validação de manifesto, compatibilidade e testes de contrato. Não exigir o SDK no sistema do usuário final. Não criar protocolo de shell genérico para facilitar extensões.

**UX:** launcher contém apps disponíveis; **Sistema → Aplicativos** lista instalação/versão/origem/saúde; **Ajustes → Privacidade e permissões** permite rever concessões se essa organização for adotada. Navegar entre as duas telas não deve criar dois stores de permissão.

**Aceite:** app incompatível ou adulterado não inicia; atualização falha preserva versão funcional; remoção distingue app e dados; permissão revogada é efetiva; dependências não geram ciclo nem execução privilegiada. **Dependências:** C20 para confiança de distribuição e uma fronteira de runtime definida. Marketplace não é necessário para provar esse ciclo.

### 5.13 C13 — Store como catálogo de capacidades

**Origem:** a visão inclui apps, perfis, workspaces, agentes, templates, conectores e temas; o módulo Store permanece planejado. [L20] [L05]

**Recorte inicial futuro:** catálogo pequeno, curado e verificável. Ficha mostra finalidade, editor, versão, modos compatíveis, permissões, dependências, tamanho e política de atualização. Instalar usa C12; a Store não inventa outro updater.

**Tipos distintos:** tema altera aparência, template cria estrutura, conector acessa serviço, agente pode propor/executar ações limitadas. Um tema não herda poder de execução de um agente por compartilhar o catálogo. Classificar e validar cada tipo.

**Depois:** publicação de terceiros, revisão, reputação, cobrança e recomendações apenas quando identidade de editor, supply chain e suporte estiverem definidos. Não preencher com cards de apps inexistentes.

**Aceite:** catálogo rejeita pacote adulterado/incompatível; origem e permissões ficam visíveis; desinstalação tem efeitos claros; falha de download não altera ambiente funcional. **Prioridade:** P3 após C12, não extensão imediata da sidebar básica.

### 5.14 C14 — Perfis profissionais

**Origem:** Developer, Business, Legal, Retail, Education, Healthcare, Creator, Design, Enterprise e Gamer são direções documentadas; o manifesto é conceitual. Não há evidência aqui de dez produtos profissionais prontos. [L19]

**Perfil deve ser composição:** sugestões de apps, layouts, templates, contexto e políticas, sobre o mesmo runtime. Escolher “Desenvolvedor” não cria outro OS, outra conta ou outra fonte de regras.

**Piloto:** um perfil opcional com ganhos verificáveis. Exemplo: um projeto de desenvolvimento, atalhos de trabalho e templates locais. Primeiro simular o impacto e mostrar o que será instalado/configurado, quais permissões serão pedidas e o que permanecerá ao desativar.

**Ativação/desativação:** mudanças reversíveis; preservar arquivos e objetos do usuário; não revogar silenciosamente acesso a conteúdo ao trocar perfil. Resolver conflitos entre perfis por política explícita; nenhuma soma de perfis pode conceder privilégios não autorizados.

**UX futura:** seleção contextual na Home/workspace; gestão em Ajustes ou catálogo de perfis com destino único definido na entrega. Não confundir perfil profissional com nome/avatar de Conta.

**Aceite:** aplicar duas vezes é idempotente; falha parcial tem rollback; desativar preserva conteúdo; permissões extras exigem concessão; perfil sem componente compatível mostra dependência. Setores regulados exigem escopo próprio — um perfil Healthcare não deve se apresentar como diagnóstico médico automático. **Prioridade:** P3, após C04/C12.

### 5.15 C15 — Objetos, relações e proveniência

**Origem:** Object System descreve identidade estável, tipo, owner, relações, eventos, sensibilidade e fontes. O documento é estratégico, não implementação de banco universal. [L21]

**Experimento mínimo:** um objeto “projeto” que referencia arquivos/documentos já existentes. ID estável e localização separados; mover um arquivo não deve obrigar a recriar o projeto. Relação não concede acesso: cada leitura exige permissão do recurso real.

**Dados propostos:** tipo/schema, título, owner, referências de origem, criado/alterado, versão, relações permitidas, classificação de sensibilidade e proveniência de conteúdo derivado. Expor apenas campos exigidos pelo caso; não fazer toda operação simples depender de um grafo global.

**UX:** painel de detalhes mostra relações úteis (“usado no projeto”, “derivado deste documento”), fonte e histórico quando real. Arquivos continua acessível para quem não usa objetos. Nenhuma reorganização destrutiva automática de pastas para adequar o modelo.

**Aceite:** referência quebrada é recuperável; acesso revogado deixa de fornecer conteúdo; derivação mantém fonte; exclusão não apaga dependentes sem semântica definida; migração de schema conserva dados. **Prioridade:** P3. Evitar implantar um motor genérico antes de demonstrar benefício em C04.

### 5.16 C16 — IA útil, opcional e com autoridade limitada

**Origem:** AI Native/Intelligence propõem contexto, modelos substituíveis, ferramentas, memória, políticas e auditoria. O módulo de produto ainda era planejado. [L05] [L16] [L17]

**Primeira entrega futura:** assistência de leitura em um projeto/documento escolhido pelo usuário, com fontes identificáveis. Exemplos: resumir arquivo selecionado, explicar uma falha sanitizada, sugerir organização. Não iniciar por agente administrador do OS.

**Configuração:** provedor/modelo, disponibilidade, limites, custo quando conhecido e política de envio de dados. Credenciais permanecem no store apropriado. Cloud e local são capacidades distintas; modelo local não deve ser prometido em hardware sem suporte medido.

**Contexto:** usuário escolhe projeto/documentos; a UI mostra o escopo. Índice/memória respeitam exclusão e revogação. Respostas derivadas preservam fonte; falta de evidência deve aparecer como incerteza, não dado do sistema.

**Ferramentas:** toda ação concreta chama operação tipada já existente, sujeita à mesma autorização e validação do usuário. Separar proposta, aprovação quando necessária, execução, recibo e eventual desfazer. Texto vindo de arquivo, site ou resultado de ferramenta não ganha autoridade de instrução do sistema.

**UX:** assistente contextual ou app próprio futuro; disponibilidade, execução e falha claramente expostas. Sair/cancelar não oculta uma ação ainda em andamento. O OS funciona sem modelo, internet, assinatura premium ou Codex.

**Aceite:** nenhuma escrita em modo consulta; revogação bloqueia ferramenta; documento malicioso não amplia permissões; segredo não entra no prompt/log; cancelamento e limites são respeitados; ferramenta relata resultado real. Testar falha do provedor e respostas sem estrutura esperada. **Prioridade:** P3, após operações de produto confiáveis.

### 5.17 C17 — Conhecimento, conectores e automações

**Conhecimento:** começar por coleção explicitamente selecionada, com fonte, data de indexação, estado de atualização e remoção. Indexar tudo em background não é o comportamento padrão recomendado. Busca simples pode existir antes de embeddings/IA.

**Conectores:** escopos visíveis, vínculo revogável, expiração e autorização do serviço externo. Consultar e enviar/mutar são permissões distintas. Uma chave de engenharia não deve virar credencial universal da conta. [L16] [L17]

**Automações:** gatilho, condição, ações tipadas, credencial usada, frequência, histórico, limite de tentativas e desligamento. Começar com ação reversível e local; reexecução deve ser idempotente. Automatizar não remove exigências de confirmação de operações destrutivas.

**UX futura:** tela própria para conexões e execuções, ligada à conta/workspace correto. Não esconder jobs persistentes dentro de preferências de aparência. Mostrar próxima execução e resultado real, sem anunciar sucesso por mero agendamento.

**Aceite:** revogar conector encerra novas chamadas; conteúdo removido deixa de entrar no contexto; reinício não duplica job; falha não gera loop ilimitado; conta diferente não herda automação. **Prioridade:** P3; depende de C08, permissões e operações estáveis.

### 5.18 C18/C19 — Diagnóstico e suporte remoto opcionais

**Preservar no protótipo:** observação de base/supervisor/Surface, guardian e rescue limitado. O canal de rescue atual não oferece shell, reboot arbitrário nem comandos genéricos. A telemetria relay é observacional. Documentar o papel de cada um antes de acrescentar qualquer canal.

**Diagnóstico local primeiro:** em **Sistema → Diagnóstico**, consolidar versão carregada, versão alvo, saúde dos processos observados, conectividade, armazenamento e eventos relevantes. Exibir fonte/horário/validade; uma falha parcial deve continuar deixando os demais dados acessíveis.

**Pacote de suporte:** gerar localmente, mostrar categorias e tamanho, remover segredos, permitir revisar/exportar e definir retenção. Captura visual é opt-in e contém potencialmente documentos pessoais; não incluir por padrão. Logs precisam de limites e rotação.

**Aprendizado do legado:** há contrato e relatos de captura PNG com arquivo privado, metadados, verificação por leitura e limites; essa é uma referência útil para integridade e privacidade, não motivo para instalar todo o Control Plane. [L23]

**Se surgir suporte remoto concreto:** identidade das partes, escopos por ação, prazo, revogação, recibo e destino vinculado. Presença não concede comando. Pareamento não autoriza captura. Transporte/criptografia padrão; nenhum endpoint genérico de shell no produto.

**Aceite:** base viva/Surface parada é representada corretamente; observação expirada fica desconhecida; pacote não inclui tokens; falha de upload não bloqueia trabalho local; sessão revogada não captura nem comanda. **Parte 1:** E7; controle remoto avançado fica fora da etapa básica.

### 5.19 C20 — Atualizações, saúde e rollback

**Origem:** o legado tem código de atualização, trust e activation. O valor é estudar invariantes como candidato verificado, referência conhecida e recuperação durável; não colocar seu engine ao lado do supervisor e da aquisição de release do protótipo. [L22]

**Dois perfis:** desenvolvimento Git-first continua com source em `main` e aplicação seletiva; distribuição canônica continua com release verificada, trust e gates próprios. Expor qual perfil está em execução em **Sistema → Sobre/Atualizações**, sem exigir que o usuário entenda o pipeline para trabalhar.

**Experiência:** versão em execução, disponível/alvo, tentativa, fase, resultado e ação requerida. Diferenciar recarregar UI, reiniciar Surface, reiniciar supervisor e manutenção de boot. Um status com SHA novo não permite anunciar atualização aplicada se a UI ainda executa o antigo.

**Identidade e histórico da entrega:** expor uma versão humana monotônica da entrega (`vN`, hoje derivada do número do PR de merge) ao lado do SHA técnico, sem substituir o SHA como identidade exata. Manter dois históricos: catálogo de entregas reconstruível pelo primeiro-parent do Git e aplicações efetivas do dispositivo persistidas localmente com horário, modo, resultado e durações. Limitar retenção; não fabricar aplicação histórica que nunca foi registrada.

**Confiabilidade:** candidato rejeitado não substitui o conhecido; mudança incompatível de estado tem política de migração/rollback; restart não perde intenção pendente; atualização não apaga arquivos. Retry deve ser limitado, identificável e seguro.

**Lacunas a fechar:** a prova física de candidato deliberadamente inválido e os gates de release canônica ainda precisam de suas evidências. A existência de preflight e guardian não equivale a ativação A/B integral. Não inventar percentual de conclusão.

**Aceite:** SHA antigo renderizado não confirma candidato novo; falha de processo é detectada pelo sinal certo; falha de rede mantém versão utilizável; retorno conhecido é verificável; um rollback do sistema não restaura indiscriminadamente os arquivos pessoais a uma data anterior. **Parte 1:** E2/E7; prioridade P0 para não regredir o que já existe.

### 5.20 C21 — Instalação, armazenamento e recuperação do produto

**Trabalho restante:** transformar as receitas e contratos em instalação canônica verificável e experiência recuperável. Isso inclui trust público, artefatos assinados, distribuição, integração Creator e provas específicas de USB/Native. Código legado de instalação não deve dirigir layout novo.

**Sistema → Armazenamento:** mostrar capacidade do perfil efetivo, usado/livre, classes de consumo quando medidas e manutenção disponível. Separar dados pessoais, apps, releases conhecidas e estado; evitar gráfico sem fonte. Não apresentar migração para arquitetura futura como botão trivial.

**Sistema → Recuperação:** distinguir reiniciar Surface, restaurar versão do sistema, reparar configuração, restaurar backup e apagar dados/redefinir instalação. Cada ação tem alcance próprio; diagnóstico precede operações destrutivas. Recuperar sistema preserva dados pessoais por padrão.

**Instalação Native futura:** identificar inequivocamente o disco, apresentar plano, compatibilidade, espaço e efeitos sobre boot/dados. Dual boot não está comprovado por existir como ideia; suporte requer decisão e testes próprios. Exigir evidência descartável antes de operação física e autorização específica no momento adequado.

**Armazenamento:** seguir [arquitetura adotada](docs/STORAGE-ARCHITECTURE.md), contratos de artefato e capacidades da mídia. Criptografia, chave de recuperação, expansão e desgaste têm comportamento por perfil. Nenhuma chave privada de assinatura entra no dispositivo ou no repositório.

**Aceite:** instalação/recovery sob interrupção, artefato adulterado, disco errado, espaço insuficiente e boot offline conhecido; dados preservados no caminho normal; reset destrutivo inequivocamente separado. O tipo de prova deve aparecer: unitária, integração descartável, CI ou física autorizada. **Prioridade:** P2 de produto com gates P0, sem bloquear UX local.

### 5.21 C22 — Build, cache e retenção

**Origem:** registro antigo descreve cache, retenção e aceleração implementados, junto de uma visão maior de Build Intelligence. O pipeline antigo carrega escolhas de host/tooling que não são requisitos do protótipo. [L03]

**Preservar:** fonte em `main`, receitas versionadas, ambiente fixado, testes, hashes/provenance e artefatos consumíveis sem Codex. Não reconstruir kernel por uma mudança de CSS; não tornar a estação do desenvolvedor um servidor de build obrigatório.

**Melhoria incremental:** medir tempo por etapa, custo de cache miss e causas de reconstrução; mapa de impacto derivado de dependências reais; cache com chave que inclua fontes/ferramentas relevantes; retenção que preserve releases conhecidas e suas evidências.

**Aceite:** cache não muda saída esperada nem ignora dependência; execução limpa produz os mesmos artefatos; falha de cache permite build normal; descarte de artefato não remove a única versão de recuperação válida. Otimização só entra após medição; análise de IA não decide assinatura ou promoção.

### 5.22 C23/C24 — Inteligência do projeto, laboratório e federação

**Estado do legado:** Project Intelligence é planejado, de leitura, com resultados derivados de Git, testes, contratos e evidências; Federation é arquitetura documental de descoberta/intercâmbio, sem autoridade de mutação. [L24] [L25]

**Primeiro benefício possível:** relatório versionado de capacidades, último teste, ambiente, SHA, evidência e bloqueio. Pode ser gerado pelo CI antes de existir Mission Control. Ausência de prova produz “não demonstrado”, nunca “concluído”.

**Painel futuro:** separar implementado, testado em CI, provado no hardware e autorizado para release. Fórmula, timestamp e links precisam acompanhar métricas. Estimativas devem mostrar premissas; não declarar “90% pronto” apenas contando documentos ou testes.

**Research Lab:** experimentos isolados, entradas/saídas rastreáveis, possibilidade de descarte e promoção explícita para source revisado. Um agente de pesquisa pode recomendar; não altera contrato, trust ou mídia automaticamente.

**Federação:** apenas quando houver dois ou mais nós e necessidade real de cooperação. Identidade, descoberta, capacidades anunciadas versus comprovadas e política de compartilhamento. Nenhuma confiança transitiva automática; anúncio não autoriza executar tarefa nem ativar release.

**Aceite:** métrica reproduzível a partir de evidências; relatório antigo não aparece como atual; nó revogado deixa de ser aceito; fluxo local segue funcionando sem rede federada. **Prioridade:** P3. A palavra “supervisor” nessa visão de agentes não deve se confundir com o supervisor de processos nativo já implementado.

### 5.23 C25 — Navegador, editor e produtividade

**Constatação:** o módulo Browser do legado está planejado. As jornadas profissionais indicam necessidades, não uma suíte de aplicativos já pronta. [L05] [L18]

**Próximo passo útil:** visualizadores limitados e abertura segura de arquivos na infraestrutura atual. Um editor pequeno só entra com salvamento, rascunho e recuperação definidos. Links externos devem informar seu destino e usar capacidade própria; não navegar a Surface privilegiada para conteúdo arbitrário.

**Se houver navegador de produto:** definir isolamento, armazenamento por perfil, downloads, permissões, atualizações de segurança e integração com o engine. Não chamar um webview simples de navegador completo. Avaliar integração com aplicações existentes quando possível.

**Aceite de visualização/edição inicial:** formato não suportado é explícito; conteúdo ativo não ganha privilégio do shell; erro ao salvar preserva rascunho; arquivo aberto não é truncado automaticamente. **Prioridade:** visualização em C01/P1; apps completos P2/P3 conforme demanda.

### 5.24 C26 — Onboarding, notificações e acessibilidade

Essas capacidades são necessidades de produto inferidas das jornadas e da diferença entre infraestrutura e uso diário. Não foram localizadas como uma pilha completa pronta para portar do legado. A primeira parte já especifica estados, teclado e comportamento comum.

**Primeiro uso:** explicar modo e armazenamento disponível, oferecer rede quando necessário, preferências básicas e conta opcional para continuidade. Não bloquear uso local por ausência de login. Em USB temporário, esclarecer o que persiste sem afirmar persistência que o perfil não oferece.

**Notificações:** central pequena com origem, horário, nível, ação e estado lido/dispensado. Eventos reais de cópia, sync, atualização e dispositivo. Não converter todo heartbeat em aviso. “Não perturbe” controla apresentação conforme política; falha crítica continua consultável no owner.

**Acessibilidade:** teclado completo, foco visível, rótulos, contraste, escala, redução de movimento e leitores de tela nos hosts suportados. A navegação para toque/mobile deve manter o mesmo domínio de comportamento, com composição responsiva.

**Aceite:** usuário completa fluxo básico sem mouse; formulários não perdem foco ao atualizar dados; notificação abre o item correto; dispensar aviso não cancela operação; onboarding pode ser retomado sem duplicar configuração. **Parte 1:** E1/E3 e requisitos transversais, prioridade P1.

### 5.25 C27 — Backup, versões e restauração de dados

**Distinção necessária:** checkpoint de sessão restaura contexto; rollback de release restaura software; sync replica mudanças; backup permite recuperar dados após perda, erro ou exclusão. Um não substitui automaticamente o outro.

**MVP futuro:** usuário escolhe dados e destino suportado; produto estima escopo, cria cópia consistente com manifesto/integridade e permite testar restauração para um local separado. Exibir última execução realmente concluída, retenção e falhas por item.

**Histórico:** preservar versões quando a operação requer recuperação. Armazenamento cheio não deve eliminar a única cópia válida antes de confirmar a nova. Backup criptografado precisa de política de chave/recuperação; não prometer recuperação sem a chave necessária.

**UX:** visão e políticas em Sistema → Backup/Recuperação; restauração de item pode iniciar em Arquivos e usar o mesmo serviço. Conta mostra consumo cloud somente se houver backend. Não criar dois mecanismos de backup.

**Aceite:** restaurar arquivo conhecido em novo local e comparar conteúdo; simular interrupção e item inacessível; expor cobertura parcial; excluir na origem não apaga automaticamente todas as versões protegidas. **Prioridade:** P2 após C01 e política de armazenamento.

## 6. Onde cada capacidade aparece na interface

### 6.1 Preservar a organização da parte 1

**Atualizações pertence a Sistema.** Ajustes pode ter um link contextual se necessário, mas não uma segunda implementação, fonte de dados ou histórico. O mesmo princípio vale para Armazenamento, Sobre e Recuperação.

| Destino | Conteúdo desta evolução | O que encaminha para outro owner |
|---|---|---|
| Home / mesa | Continuar trabalho, projetos/recentes autorizados, pendências resumidas, apps reais. | Diagnóstico completo, sync detalhado e manutenção. |
| Arquivos → Meu espaço | Listagem, seleção, abertura, criação, cópia/movimentação, detalhes. | Capacidade total/limpeza de releases vai a Sistema. |
| Arquivos → Recentes/Favoritos | Referências reais, limpar histórico e remover favorito sem apagar conteúdo. | Login necessário para conteúdo remoto vai a Conta. |
| Arquivos → Projetos | Contexto de trabalho e ligação com conteúdo/apps, quando C04 existir. | Instalação de app requerido vai ao owner de aplicativos. |
| Arquivos → Lixeira | Itens recuperáveis, prazo e restauração quando backend existir. | Reset do sistema nunca é ação da lixeira. |
| Ajustes → Aparência/Acessibilidade | Tema e preferências implementadas, escala/contraste/movimento conforme suporte. | Status de release não entra aqui. |
| Ajustes → Rede | Interfaces, Wi-Fi/redes salvas e ações autorizadas por modo. | Saúde geral em Sistema mostra resumo/link. |
| Ajustes → Áudio/Tela/Entrada | Configuração dos periféricos disponíveis. | Inventário/driver/diagnóstico detalhado vai a Sistema. |
| Ajustes → Privacidade/Notificações | Concessões e preferências de apresentação, histórico local quando suportado. | Identidade e sessões cloud vão a Conta. |
| Conta → Visão geral/Perfil | Estado da conta, dados editáveis suportados e vínculo local/cloud. | Perfil profissional é conceito distinto. |
| Conta → Sincronização | Tipos sincronizados, fila, conflitos, erros e políticas pessoais. | Backup/rollback não são outro nome para sync. |
| Conta → Dispositivos/Sessões | Vínculos, pareamento, última atividade e revogação. | Periféricos ficam em Ajustes; drivers em Sistema. |
| Conta → Segurança/Plano | Autenticação, segurança da conta e direitos reais do serviço. | Não inventar MFA, cobrança, preço ou benefício ainda não oferecido. |
| Sistema → Visão geral | Modo, versão efetiva, estado geral derivado e problemas acionáveis. | Atalhos para as telas responsáveis; evitar repetir formulários. |
| Sistema → Atualizações | Alvo/em execução, progresso, resultado e histórico real. | Atualizações do cliente Desktop/OS identificadas por canal. |
| Sistema → Armazenamento | Capacidade medida, consumo e manutenção compatível com o perfil. | Conteúdo é gerenciado por Arquivos. |
| Sistema → Hardware | Inventário, compatibilidade, driver e limitações conhecidas. | Controles cotidianos de rede/áudio em Ajustes. |
| Sistema → Aplicativos | Apps instalados, versões, origem, integridade, manutenção. | Catálogo/descoberta futura pode ser Store, usando os mesmos serviços. |
| Sistema → Diagnóstico | Sinais atuais, eventos, exportação revisável e suporte opcional. | Não virar terminal administrativo geral. |
| Sistema → Recuperação/Backup | Planos de recuperação e restauração com alcance explícito. | Conta só exibe vínculo/capacidade de cloud quando existir. |
| Sistema → Sobre | Identidade do produto, modo, versão, build/provenance e licenças. | Não misturar com edição do nome/avatar pessoal. |

Subseções novas só ficam acionáveis quando o contrato e o serviço existem. Enquanto isso, registrar o backlog aqui; não encher a interface com navegação vazia.

### 6.2 Exemplo completo: Sistema → Visão geral

**Topo:** nome do produto e modo efetivo; versão de runtime/interface comprovada; indicação de perfil de desenvolvimento ou release canônica. A nomenclatura deve vir de dados válidos.

**Área principal:** resumo de saúde, atualização e armazenamento, cada um com estado/horário apropriados e link para detalhamento. Saúde pode ser “atenção: interface anterior ainda ativa”, não apenas um ponto verde geral.

**Pendências:** ações possíveis e específicas, como abrir detalhes da atualização, revisar falta de espaço ou gerar diagnóstico. Não mostrar “Corrigir tudo” se não existe operação que conheça o impacto.

**Resumo de hardware/conectividade:** dados medidos suficientes para entender o equipamento, com acesso a Hardware e Ajustes → Rede. Sem métricas indisponíveis preenchidas com zero.

**Em falha parcial:** dados válidos continuam visíveis; o componente sem observação mostra indisponível/antigo. A base viva não mascara Surface congelada. O usuário ainda deve conseguir copiar/exportar informação diagnóstica permitida.

**Critério de conclusão:** a tela explica o estado e oferece caminhos reais. Não precisa conter configuração de tudo. O detalhamento campo a campo das páginas base permanece na parte 1; este exemplo acrescenta as diferenças reveladas pela comparação.

### 6.3 Jornadas de produto para validar a integração

| Jornada | Caminho esperado | Evidência mínima |
|---|---|---|
| Começar sem conta | Abrir produto → escolher tema → criar pasta → abrir conteúdo permitido. | Uso local não exige cloud; persistência compatível com modo. |
| Trabalhar offline | Abrir projeto → alterar estado permitido → fechar/reabrir → reconectar. | Estado local preservado; fila retoma sem duplicar. |
| Trocar de dispositivo | Entrar na mesma conta → obter metadados → resolver conteúdo ausente. | Sem paths inválidos tratados como locais; sem segredo transferido. |
| Conectar notebook | Ajustes → Rede → selecionar Wi-Fi → autenticar → obter conectividade. | Etapas/erros reais e credencial não exposta. |
| Atualizar enquanto usa | Detectar candidato → verificar → aplicar escopo → confirmar UI efetiva. | SHA renderizado correto; trabalho recuperável preservado. |
| Recuperar falha | Falha de candidato/processo → retorno conhecido → diagnóstico. | Sem shell externo obrigatório; limites/gates respeitados. |
| Instalar app futuro | Ver origem/permissões → instalar → usar → atualizar → remover. | Integridade e políticas efetivas; dados tratados explicitamente. |
| Usar IA futura | Selecionar contexto → consultar → rever proposta → executar ação autorizada. | Fonte e escopo visíveis; operação real produz recibo. |

## 7. O que preservar e o que não transportar

### 7.1 Reaproveitar invariantes, não o volume do repositório

| Aprendizado valioso | Aplicação no protótipo |
|---|---|
| Operação de arquivo confinada e sem sobrescrita acidental. | Estender a porta de arquivos com validação backend e testes de corrida/falha. |
| Workspace/sessão preservados ao bloquear ou recuperar. | Estado por app e lifecycle comum, com autenticação adequada. |
| Rede distingue hardware, associação, IP e acesso externo. | Status estruturado em adapter e mensagens úteis em Ajustes. |
| Capacidade declarada difere de capacidade disponível/provada. | Manter matriz de modos e UI dependente de suporte real. |
| Atualização tem verificação, resultado e retorno conhecido. | Consolidar owners atuais de Git-first/release canônica. |
| Evidência tem source, ambiente, data e escopo. | Testes/CI/diagnóstico sem percentuais ou PASS inventados. |
| Home apresenta contexto e encaminha intenções. | Um shell compartilhado, sem duplicar owners operacionais. |
| Perfil compõe ferramentas; objeto mantém origem; IA não é autoridade. | Experimentar em recortes pequenos depois da base útil. |

### 7.2 Rejeições explícitas

- **Cópia de pastas, histórico e artefatos:** não importar `history`, laboratórios, caches, backups, imagens ou rootfs inteiro como implementação.
- **Layout antigo como verdade:** não trazer automaticamente partições PLATFORM/HOME, paths e scripts que presumem aquela instalação.
- **Segundo desktop:** não copiar o renderer C/PF02 como novo owner visual nem recriar UI por modo. A Surface compartilhada atual continua central.
- **Login de preview:** não importar usuário/senha padrão, secrets antigos, credenciais de serviço ou mecanismo simplificado como produção.
- **Engenharia obrigatória:** não exigir SSH, WSL, QEMU, F7, DevLink, Control Plane ou Codex para o uso normal, build do usuário ou atualização cotidiana.
- **Novo plano de controle paralelo:** não acrescentar executores remotos genéricos porque o legado tinha mais serviços. Começar pelo requisito e pelo owner atual.
- **Bootstrap cheio:** não mover SDK, apps, IA, Store e laboratório para initramfs apenas para facilitar disponibilidade. A base mínima continua mínima.
- **Gerenciadores concorrentes:** não criar segundo updater, fila de sync, store de preferências, gerenciador de janelas, autoridade de conta ou daemon de rede sem justificar a fronteira.
- **Módulo planejado tratado como entregue:** nome de diretório, manifesto vazio, imagem conceitual e documento de visão não contam como feature implementada.
- **Segurança por interface:** esconder botão não substitui autorização do backend; assinatura não comprova compatibilidade; pareamento não concede todo privilégio.
- **Compatibilidade permanente sem dono:** bridge provisória deve ter justificativa, testes e condição de remoção. Não carregar protocolo antigo só para evitar redesenhar um contrato pequeno.

### 7.3 Como registrar uma migração real

Este documento faz análise e recomendações; **nenhum componente antigo foi portado por esta entrega**. O ledger canônico não deve receber `ADOPTED`/`REIMPLEMENTED` concluído por mera leitura comparativa.

Ao iniciar cada portabilidade, acrescentar uma entrada em [SOURCE-MIGRATION.md](docs/SOURCE-MIGRATION.md), com a origem exata e decisão por componente. Exemplo de registro a preencher — não representa migração já efetuada:

```text
COMPONENT=file-space-copy-and-rename-invariants
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_COMMIT=49fe41fa67d9032f2e349e86592304e64d6c2d88
LEGACY_PATH=ordax-bootstrap/rootfs-overlay/ordax/explorer/lib/explorer.sh
RESPONSIBILITY=bounded file operations with explicit conflict/failure semantics
WHY_NEEDED=complete daily file workflows in the shared product
DEPENDENCIES=current file-space contract and native/web/desktop capability boundaries
SECURITY_REVIEW=record path confinement, symlink, collision and race analysis
TESTS=record new prototype tests and actual results
ARTIFACT_SHA256=NOT_APPLICABLE
DECISION=REFERENCE_ONLY
TARGET_PATH=system/contracts/file-space.mjs + system/adapters/native/file-space.mjs
IMPLEMENTATION=PENDING
NOTES=example for evaluation only; record the later implementation decision explicitly; do not copy the legacy shell framework or claim its tests as new proof
```

Antes de incorporar código literalmente, revisar licença/proveniência, dependências, compatibilidade com os contratos atuais e testes. Se o comportamento já existe na `main`, registrar preservação/fechamento do gap, não criar implementação duplicada.

## 8. Sequência de implementação e dependências

### 8.1 Etapas executáveis

As entregas F abaixo complementam, sem substituir, E0–E10 da parte 1. Cada linha deve ser dividida em PRs/commits pequenos quando envolver mais de um contrato.

| Entrega | Objetivo e recorte | Depende de | Saída/aceite para encerrar |
|---|---|---|---|
| F0 | Atualizar inventário e matriz real de capacidades por modo. | `main`, docs canônicos, E0. | Para cada botão proposto, owner e suporte real identificados. |
| F1 | Navegação e estados dos quatro apps, destinos únicos. | E1–E3/E5. | Atualizações só em Sistema; estado ausente/antigo/offline honesto. |
| F2 | Arquivos: leitura/abertura, renomear e copiar em incrementos. | F1, C01, E4. | Conteúdo real, proteção da raiz, erros/colisões/cancelamento verificados. |
| F3 | Rede cotidiana no ambiente nativo. | Porta/adapters C02. | Selecionar/conectar/esquecer/reconectar com prova no hardware-alvo. |
| F4 | Contexto local: projeto pequeno, recentes e retomada. | F2, C04–C06. | Usuário retoma trabalho após reload sem duplicação ou promessa falsa. |
| F5 | Sessão/bloqueio, notificações e permissões locais necessárias. | C03/C26, política de identidade local. | Proteção efetiva no host suportado e uso acessível. |
| F6 | Conta real e sync de um conjunto pequeno de metadados. | C08/C09, E8, serviço/provedor decidido. | Dois clientes autorizados, offline/conflito/revogação provados. |
| F7 | Mobile/Desktop compartilhados, em entregas separadas. | C10/C11; F6 para continuidade entre contas/dispositivos. | Pacotes reais, adapters e lifecycle de cada alvo verificados. |
| F8 | Confiança e distribuição canônica; Creator/Native por gates. | C20/C21, contratos e trust ceremony. | Evidências e artefatos requeridos; autorização física independente. |
| F9 | Diagnóstico, recuperação e backup de dados. | C18/C27, F2 e estado de storage. | Exportação sanitizada e restauração de conteúdo demonstrada. |
| F10 | Um app instalável e SDK mínimo. | C12, runtime/permissions/trust definidos. | Instalação, atualização falha e remoção seguras sem Store completa. |
| F11 | Um perfil profissional e objetos mínimos úteis. | C04/C12/C14/C15. | Benefício concreto e desativação sem perda de dados. |
| F12 | IA contextual de leitura; depois ferramenta limitada. | C16, autorização, operações estáveis e contexto escolhido. | Fonte/escopo visíveis; falha/abuso/cancelamento testados. |
| F13 | Catálogo ampliado, conectores e automações. | C13/C17 e ciclos anteriores. | Descoberta/distribuição/execução com política efetiva e auditoria. |
| F14 | Inteligência do projeto/federação se houver caso real. | Evidências e necessidade de múltiplos nós. | Observação rastreável; nenhuma autoridade operacional implícita. |

F3, a observabilidade local de F9 e as provas de F8 podem avançar em trilhas independentes, sem esperar IA, Store ou conta. A ordem não autoriza saltar requisitos de integridade, dados ou autorização.

### 8.2 O próximo lote recomendado

F0/F1 e os primeiros incrementos de F2 já avançaram na `main`. F3 agora possui observabilidade nativa, owner mutável de Wi-Fi no host, jornada compartilhada em Ajustes para scan/seleção/conexão/desconexão/esquecimento/reconexão via `ordax.network-management/1` e bandeja persistente que deriva Wi‑Fi/cabo/sinal exclusivamente da porta read-only `ordax.network-status/1`. Credenciais, SSID e identificadores de hardware continuam fora dessa bandeja e da telemetria. A próxima revalidação de F3 deve ampliar somente capacidades demonstradas no hardware-alvo (por exemplo redes abertas/WPA3/portal cativo), sem inflar a UI com opções fictícias.

Não abrir simultaneamente Store, grafo de objetos, federação, IA e um package manager. A entrega de arquivos, rede e retomada já recupera valor concreto que o legado perseguia, mantendo a estrutura limpa.

### 8.3 Decisões que devem ser tomadas quando a entrega começar

| Decisão | Momento | Direção recomendada / o que precisa ser demonstrado |
|---|---|---|
| Conta/provedor e retenção de sessão | F6 | Um modelo de identidade; autorização server-side e isolamento entre usuários. |
| Política de usuário local/offline | F5 | Separar usuário local, sessão, conta cloud e bloqueio de host. |
| Transporte remoto de sync | F6 | Reusar core; idempotência, revisões e conflitos testáveis. |
| Empacotamento Mobile/Desktop | F7 | Shell/adapters finos; consumir Surface compartilhada; validar hosts reais. |
| Escopo inicial de app externo | F10 | Um app sem privilégio; manifesto e ciclo de vida pequenos. |
| Primeiro perfil profissional | F11 | Uma jornada com ganho demonstrável; Developer é candidato, não escolha obrigatória. |
| Modelo de objeto | F11 | Evoluir projeto/referências existentes antes de grafo universal. |
| Provedor/modelo de IA e dados permitidos | F12 | Opcional, substituível, contexto explícito e limites de custo/privacidade. |
| Canal de suporte remoto extra | Quando houver requisito | Justificar por que diagnóstico local/rescue atual não atende; escopo e revogação. |
| Rollout do storage durável | F8 | Seguir arquitetura adotada e provas por artefato; sem novo layout decidido por UI. |
| Backup e retenção | F9 | Definir perda coberta e comprovar restauração, não só envio. |

Essas decisões não impedem criar navegação, melhorar acessibilidade ou entregar operações locais já autorizadas pela arquitetura.

## 9. Contrato de entrega para o GPT implementador

### 9.1 Checklist antes de modificar source

1. Ler `AGENTS.md`, docs canônicos e os dois planos; atualizar referências remotas e registrar o SHA da execução.
2. Escolher uma entrega F/E e declarar objetivo, entradas/saídas e o que significa concluí-la.
3. Localizar o owner atual, contrato, adapters, UI e testes. Marcar gaps que já foram fechados na `main`.
4. Se usar o legado, selecionar paths exatos e registrar a decisão no ledger. Não copiar diretórios inteiros.
5. Definir dados reais, autoridade, persistência, permissões, falhas, compatibilidade e acessibilidade antes de desenhar controles.
6. Implementar o menor fluxo completo; uma operação funcionando com limites explícitos é uma entrega válida. Um conjunto de botões sem serviço não é.

### 9.2 Critérios transversais de conclusão

- manter uma única versão visível da release do OrdaX para componentes distribuídos juntos; não criar versões artificiais por app;
- manter rede/conectividade e relógio visíveis no shell compartilhado, fora da dependência de uma janela específica;

| Dimensão | Evidência exigida |
|---|---|
| Funcional | Jornada normal exercida com dados reais, no escopo implementado. |
| Persistência | Reload/restart mantém o estado que a funcionalidade promete. |
| Falha | Pelo menos os erros materiais do fluxo preservam dados e permitem continuar. |
| Segurança | Autorização no owner; rejeição de IDs/paths/tokens inválidos; segredo fora de logs. |
| Modos | Funciona onde o adapter existe; indisponibilidade honesta onde não existe. |
| Interface | Foco/teclado/estado de carregamento e erro; sem duplicação de páginas/owners. |
| Compatibilidade | Estado/contrato anterior tratado por política explícita. |
| Engenharia | Receita e testes reproduzíveis; sem comando manual oculto essencial. |
| Documentação | Inventário, contrato e ledger atualizados quando o comportamento muda. |
| Evidência | Distinguir inspeção de source, teste executado, CI e prova física. |

Testar de acordo com o risco e a mudança. Não executar build de kernel por edição documental; não afirmar prova física porque um unit test passou. Uma seção pode ser entregue parcialmente se a UI restringir seu alcance de modo claro e o restante permanecer no backlog.

### 9.3 Prompt pronto para uma entrega

```text
Trabalhe no repositório prototipo-ordax-os. Leia AGENTS.md e toda a ordem
canônica indicada nele. Depois leia PLANO-FUNCIONAL-SURFACE-E-APPS.md e
PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md.

Implemente a entrega [F/E escolhida] e a capacidade [Cxx], no seguinte
recorte: [descrever uma jornada concreta]. Antes de editar, compare o
inventário dos planos com a main atual e preserve tudo que já funciona.

Use a única Surface e os apps compartilhados de system/. Diferenças de
ambiente pertencem aos adapters. Reuse os owners/contratos existentes;
não crie outro updater, store de preferências, sync ou gerenciador de janelas.

Se consultar o novo-ordax-os, trate-o como referência. Registre origem,
SHA, responsabilidade, dependências, revisão e testes no SOURCE-MIGRATION
ao efetuar uma migração. Reimplemente o comportamento necessário sem copiar
pastas ou importar o runtime antigo. Ideias e módulos planned não são
funcionalidades prontas.

Entregue dados e operações reais, com persistência, estados de falha,
limites por modo e acessibilidade. Não crie controles fictícios. Mantenha
Atualizações/Armazenamento/Recuperação/Sobre sob Sistema e identidade/sync
sob Conta; use links contextuais para evitar telas duplicadas.

Execute os testes apropriados, relate o que foi efetivamente verificado
e atualize a documentação afetada. Não declare release canônica, instalação
ou prova física sem os gates e evidências próprios. Não faça escrita física
como efeito colateral desta entrega de produto.

Ao terminar, informe: comportamento entregue; arquivos/contratos alterados;
testes e resultados; modos disponíveis; limites restantes; próximo incremento.
```

### 9.4 Prompt para manter este inventário atualizado

```text
Compare a main atual com os SHAs registrados nos dois planos da raiz.
Atualize somente as classificações e lacunas comprovadas por source,
contratos e evidências. Para cada mudança de status, cite o arquivo e a
prova correspondente. Preserve a distinção entre código, visão, relato,
teste executado e autorização de produto. Não invente porcentagem geral
de conclusão nem marque uma ideia como implementada por existir uma pasta.
```

## 10. Inventário das ideias do legado

O quadro abaixo mantém a rastreabilidade do registro de ideias sem transformar a fila antiga em backlog obrigatório. Os estados são os registrados no legado no recorte inspecionado, não novos resultados de teste. [L03] A Adaptive Platform possui referência própria. [L26]

| Ideia(s) | Conteúdo/estado registrado | Tratamento recomendado |
|---|---|---|
| 0001 | Base permanente de conhecimento/documentação. | Preservar documentação rastreável, com fonte e autoridade claras. |
| 0002 | Investigação histórica de boot lento, estacionada. | Não herdar como bug atual; medir o boot do protótipo. |
| 0003 | Session Manager, com marcos registrados como implementados. | C03/C05, reimplementar apenas gaps reais. |
| 0004 | Adaptive Hardware Graph, aprovado/estacionado. | C07, inventário simples antes de grafo adaptativo. |
| 0005 | Build Intelligence, proposta aprovada. | C22; medição/cache antes de inteligência. |
| 0006 | Administração por IA/múltiplos agentes, proposta. | C16/C24, P3; nenhuma autoridade implícita. |
| 0007 | Perfis profissionais, proposta aprovada. | C14, um piloto opcional após base útil. |
| 0008 | Primeira experiência utilizável. | Objetivo atendido por jornadas concretas F1–F5, não por copiar telas. |
| 0009 | Login Manager, especificação e tarefas de implementação. | C03, autenticação local distinta de conta. |
| 0010 | Login textual temporário, implementação/relato de prova. | Referência de fluxo; rejeitar credenciais/mecanismo de preview como produto. |
| 0011 | Experiência interativa e lock/unlock preservando sessão. | C03, conservar trabalho ao bloquear. |
| 0012 | Desktop Experience, posteriormente detalhada pela FDE. | Preservar Surface atual; evoluir UX. |
| 0013 | Workspace mínimo implementado. | C04, sem inferir perfis/checkpoints completos. |
| 0014 | Processo de preview/release reproduzível especificado. | C20/C22, usar contratos e CI atuais. |
| 0015 | DevLink com checkpoint bloqueado no contrato de confirmação física. | Não tornar DevLink requisito do protótipo. |
| 0016 | Intelligence especificada. | C16/C17, visão futura. |
| 0017 | Mapa de arquitetura especificado. | C23, gerar a partir de source/contratos. |
| 0018 | Retenção de artefatos registrada como implementada. | C22, política pequena e compatível com rollback. |
| 0019 | Cache/aceleração de build registrados como implementados. | C22, reaproveitar invariantes; medir antes de portar. |
| 0020 | First Desktop Experience, relatos de QEMU/notebook. | Evidência histórica; não substituir renderer compartilhado do protótipo. |
| 0021 | Explorer inicial com validação QEMU registrada. | C01; código posterior de operações tem testes específicos. |
| 0022 | Settings inicial read-only validado em QEMU. | Não confundir com ajustes mutáveis completos; parte 1 rege UX nova. |
| 0023 | Plataforma de desenvolvimento em andamento. | Reavaliar funções isoladas; rejeitar pacote obrigatório de tooling antigo. |
| 0024 | DX implementado para desenvolvimento. | Ferramentas opcionais; hooks futuros não são features prontas. |
| 0025 | Discovery/transporte de desenvolvimento implementados. | Não importar política antiga que conflita com Git-first atual. |
| 0026 | Fundação de conectividade implementada. | C02, manter boot e rede cotidiana coerentes. |
| 0027 | Estado de interfaces de rede implementado. | C02/C07, fonte real e estados distintos. |
| 0028 | FCE/setup/primeiro boot/reconexão registrados como implementados. | C02/C26, reimplementar jornada no shell compartilhado. |
| 0029 | Suporte RTL8188EU com relato físico específico. | C07; prova restrita ao hardware/driver descrito. |
| 0030 | GDEF e support packs implementados com escopo de hardware limitado. | C07, catálogo declarativo e validação por dispositivo. |
| 0031 | Persistência/reboot/recovery de conectividade com relato de prova. | C02; reproduzir testes no ambiente novo. |
| 0032 | Deployment Foundation especificada no checkpoint. | C20/C21, não considerar distribuição final pronta. |
| 0033 | Fast build com pipeline antigo implementado. | C22; não exigir WSL/QEMU no host do usuário. |
| 0035 | Adaptive Platform: base pequena, componentes sob demanda e versões independentes. | Parcialmente alinhada ao bootstrap/updates atuais; IA de montagem permanece futura. |

A numeração acima segue as entradas identificadas nas fontes consultadas; não pressupõe que números ausentes correspondam a entregas concluídas. Novos documentos/commits podem alterar o registro e precisam de revalidação.

## 11. Fontes rastreáveis

### 11.1 Legado — todas fixadas no mesmo commit

Os identificadores L usados no texto apontam para este catálogo. Caminhos complementares na mesma linha esclarecem onde há código, teste ou apenas documentação.

- **L01 — [README do legado][L01]:** modelo antigo de plataforma, desenvolvimento e autoridade.
- **L02 — [handoff/estado histórico][L02]:** limites operacionais, dívida de bootstrap e checkpoints; não é estado vivo do protótipo.
- **L03 — [registro de ideias][L03]:** títulos, estados registrados e ligações com missões/provas.
- **L04 — [fila antiga superseded][L04]:** não deve governar a nova prioridade.
- **L05 — [manifesto de IA planejada][L05], [Store planejada][L05s], [Browser planejado][L05b] e [Cloud planejada][L05c].**
- **L06 — [implementação Explorer][L06] e [testes de operações de arquivos][L06t].**
- **L07 — [biblioteca Wi-Fi][L07]:** scan, conexão, credenciais, status e reconexão.
- **L08 — [identidade local][L08] e [lock/unlock][L08l]:** implementação de preview, não autenticação final.
- **L09 — [projetos][L09] e [workspaces][L09w]:** operações e vínculos de contexto.
- **L10 — [checkpoints de sessão][L10]:** criação, integridade e restauração de registros.
- **L11 — [árvore de hardware/GDEF][L11]:** device matching, drivers, firmware e support packs; ver também as evidências referenciadas em L03.
- **L12 — [SDK v0][L12] e [CLI do SDK][L12c]:** comandos e limites declarados.
- **L13 — [tela mobile de pareamento][L13] e [cliente de pairing][L13c]:** desafio, storage e sessão Companion.
- **L14 — [fundação isolada da Home][L14]:** estado de integração e separação entre fontes, apresentação e intenção.
- **L15 — [índice de Intelligence][L15]:** natureza arquitetural/documental.
- **L16 — [arquitetura de Intelligence][L16]:** organização futura da camada; ler subordinada ao escopo documental indicado no índice.
- **L17 — [AI Native][L17]:** contexto, modelos, ferramentas e limites de autoridade.
- **L18 — [Experience Book][L18]:** jornadas e direção de produto.
- **L19 — [Profiles][L19]:** perfis profissionais e manifesto conceitual.
- **L20 — [Store Vision][L20]:** catálogo ampliado e condições de distribuição.
- **L21 — [Object System][L21]:** objetos, relações e proveniência como visão.
- **L22 — [update][L22], [package runtime][L22p] e [crate de activation][L22a]:** referências de implementação, não decisão de adoção.
- **L23 — [Visual Capture Archive][L23]:** contrato, escopo e relatos de verificação do arquivo privado.
- **L24 — [Project Intelligence][L24]:** iniciativa planejada e de leitura, derivada de evidências.
- **L25 — [Federation Foundation][L25]:** arquitetura documental, sem autoridade de mutação.
- **L26 — [Adaptive Platform][L26]:** evolução por componentes, base pequena e ideias ainda não implementadas.

### 11.2 Protótipo — autoridades a reler antes de implementar

- [AGENTS.md](AGENTS.md) e [README.md](README.md).
- [CURRENT-STATE.md](docs/CURRENT-STATE.md), [ARCHITECTURE.md](docs/ARCHITECTURE.md) e [DECISIONS.md](docs/DECISIONS.md).
- [PRODUCT-MODES.md](docs/PRODUCT-MODES.md), [ACCOUNT-SYNC-AND-PLANS.md](docs/ACCOUNT-SYNC-AND-PLANS.md) e [product-capabilities.json](docs/contracts/product-capabilities.json).
- [BUILD-AUTONOMY.md](docs/BUILD-AUTONOMY.md), [MINIMAL-USB-BOOTSTRAP.md](docs/MINIMAL-USB-BOOTSTRAP.md) e [DEVELOPMENT-WORKFLOW.md](docs/DEVELOPMENT-WORKFLOW.md).
- [STORAGE-ARCHITECTURE.md](docs/STORAGE-ARCHITECTURE.md), [storage-architecture.json](docs/contracts/storage-architecture.json), [physical-media.json](docs/contracts/physical-media.json) e [physical-prepared-media.json](docs/contracts/physical-prepared-media.json).
- [REMOTE-CONTROL.md](docs/REMOTE-CONTROL.md), [diagnostics.json](docs/contracts/diagnostics.json) e [module-boundaries.json](docs/contracts/module-boundaries.json).
- [SOURCE-MIGRATION.md](docs/SOURCE-MIGRATION.md), [PROMOTION-GATES.md](docs/PROMOTION-GATES.md) e [RELEASE-TRUST-CEREMONY.md](docs/RELEASE-TRUST-CEREMONY.md).
- [Contratos de produto](system/contracts/README.md), [catálogo de apps](system/apps/catalog.mjs), [sync](system/services/sync/README.md), [Mobile](system/adapters/mobile/README.md) e [Desktop](system/adapters/desktop/README.md).
- [Parte 1 — especificação funcional detalhada da sidebar](PLANO-FUNCIONAL-SURFACE-E-APPS.md).

[L01]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/README.md
[L02]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/CURRENT-HANDOFF.md
[L03]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/knowledge/IDEA-REGISTRY.md
[L04]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/knowledge/NEXT-QUEUE.md
[L05]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/modules/registry/ordax.ai/module.json
[L05s]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/modules/registry/ordax.store/module.json
[L05b]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/modules/registry/ordax.browser/MODULE.md
[L05c]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/modules/registry/ordax.cloud/MODULE.md
[L06]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/explorer/lib/explorer.sh
[L06t]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/tests/test_explorer_files_operations.sh
[L07]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/wifi/lib/wifi.sh
[L08]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/identity/lib/identity.sh
[L08l]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/identity/lib/lock.sh
[L09]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/project/lib/project.sh
[L09w]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/workspace/lib/workspace.sh
[L10]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/session/lib/checkpoint.sh
[L11]: https://github.com/washingtonmsdj/novo-ordax-os/tree/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/hardware
[L12]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-sdk/README.md
[L12c]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-sdk/bin/ordax-sdk
[L13]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/apps/ordax-mobile/app/companion/pair.tsx
[L13c]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/apps/ordax-mobile/src/pairing.ts
[L14]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/desktop/home/README.md
[L15]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/intelligence/README.md
[L16]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/intelligence/ARCHITECTURE.md
[L17]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/AI-NATIVE.md
[L18]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/ORDAX-EXPERIENCE-BOOK.md
[L19]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/PROFILES.md
[L20]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/STORE-VISION.md
[L21]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/OBJECT-SYSTEM.md
[L22]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/update/lib/update.sh
[L22p]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/ordax-bootstrap/rootfs-overlay/ordax/package-runtime/lib/package-runtime.sh
[L22a]: https://github.com/washingtonmsdj/novo-ordax-os/tree/49fe41fa67d9032f2e349e86592304e64d6c2d88/crates/ordax-activation
[L23]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/FOUNDATION/CONTROL-PLANE/CONTROL-PLANE-007-VISUAL-CAPTURE-ARCHIVE.md
[L24]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/intelligence/PROJECT-INTELLIGENCE-001.md
[L25]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/architecture/ORDAX-FEDERATION-FOUNDATION-001.md
[L26]: https://github.com/washingtonmsdj/novo-ordax-os/blob/49fe41fa67d9032f2e349e86592304e64d6c2d88/docs/IDEAS/IDEA-0035-ORDAX-ADAPTIVE-PLATFORM.md
