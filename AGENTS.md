# AGENTS.md

Este arquivo e a entrada obrigatoria para qualquer IA, agente, Codex ou pessoa que trabalhe neste repositorio.

## 1. Identidade do repositorio

`prototipo-ordax-os` e uma **clean-room experimental**. Ele existe para provar uma arquitetura OrdaX OS simplificada sem depender estruturalmente de `washingtonmsdj/novo-ordax-os`.

Nao trate este repositorio como sucessor oficial enquanto `docs/PROMOTION-GATES.md` nao estiver aprovado.

## 2. Fonte de verdade

- `main` e o unico source authority deste prototipo.
- Midia fisica, notebook, imagens, backups e copias locais nao sao source authority.
- Nenhuma alteracao fisica sem equivalente reproduzivel no source.
- Nao criar caminhos paralelos para a mesma responsabilidade.
- Codex nao e source authority, build authority ou release authority.

Para geometria fisica, os contratos machine-readable vencem texto historico: `docs/contracts/physical-media.json` define o seed bootstrap independente de capacidade e `docs/contracts/physical-prepared-media.json` define o USB fisico final preparado pelo Creator.

## 3. Ordem obrigatoria de leitura

Antes de alterar codigo, contratos ou midia:

1. `README.md`
2. `docs/CURRENT-STATE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/BUILD-AUTONOMY.md`
5. `docs/PRODUCT-MODES.md`
6. `docs/MINIMAL-USB-BOOTSTRAP.md`
7. `docs/HOST-INDEPENDENCE.md`
8. `docs/REMOTE-CONTROL.md`
9. `docs/PHYSICAL-MEDIA.md`
10. `docs/DEVELOPMENT-WORKFLOW.md`
11. `docs/SOURCE-MIGRATION.md`
12. `docs/PROMOTION-GATES.md`
13. `docs/DECISIONS.md`

Quando um snapshot de estado conflitar com texto historico, `docs/CURRENT-STATE.md` e os contratos arquiteturais canonicos vencem. Para numero/geometria de particoes, os dois contratos fisicos acima sao a autoridade final porque descrevem artefatos diferentes.

## 4. Arquitetura fisica alvo

O seed e o USB final preparado nao sao o mesmo artefato:

```text
BOOTSTRAP_SEED_PARTITIONS=2
SEED_ESP=ORDAX-ESP
SEED_MAIN=ORDAX

PREPARED_USB_PARTITIONS=3
PREPARED_ESP=ORDAX-ESP
PREPARED_MAIN=ORDAX
PREPARED_DATA=ORDAX-DATA

SEPARATE_HOME_PARTITION=NO
```

`ORDAX-DATA` e target-capacity-specific e e criado pelo Creator; ele nao pertence ao seed assinado/capacity-independent. Nao reintroduzir uma particao `ORDAX-HOME` ou `ORDAX-PLATFORM` sem decisao arquitetural registrada.

## 5. Um produto, cinco modos

```text
OrdaX Web
 -> OrdaX Mobile (Android / iPhone)
 -> OrdaX Desktop
 -> OrdaX USB
 -> OrdaX Native (SSD/HD)
```

Sao modos de capacidade do mesmo produto, nao forks.

Surface, apps e logica compartilhada possuem uma unica fonte em `system/`. Diferencas de ambiente vivem apenas em adapters de capacidade.

## 6. Pendrive inicial minimo

O bootstrap possui dois perfis deliberadamente distintos: o owner/development Git-first e o canonical signed-release. Ambos compartilham `main` como source authority e nao preinstalam o produto completo.

No owner/development Git-first, a base contem kernel/initramfs, drivers/firmware selecionados, rede, CA e Git; o checkout parcial/sparse de `system/` nasce em `/workspace/ordax` e mudancas normais nao exigem reflash. No perfil canonical, o bootstrap adquire e verifica uma release assinada antes de ativa-la.

O caminho canonical minimo continua:

```text
UEFI
 -> bootloader
 -> kernel/initramfs
 -> bootstrap minimo
 -> rede minima
 -> aquisicao de release assinada
 -> verificacao
 -> recovery
```

Nao sao obrigatorios antes da primeira release:

- SSH;
- OrdaX Remote Core;
- Control Plane;
- servico de identidade persistente;
- Surface/desktop;
- apps normais;
- servicos de alto nivel;
- checkout completo do source;
- toolchain de build;
- WSL/QEMU;
- dump do repositorio antigo.

Depois do primeiro boot canonical, a release completa deve ser adquirida, verificada e materializada em `/ordax/releases/<commit>`. Uma release conhecida deve permanecer local para boot offline e rollback.

## 7. Build autonomo e independente de Codex

Nenhum artefato pode depender de Codex, memoria de comandos manuais ou toolchain instalada na maquina do desenvolvedor.

```text
source em main
 -> receita versionada no repo
 -> ambiente de build fixado
 -> CI
 -> testes
 -> provenance + SHA-256
 -> artefato
```

Isso inclui kernel, initramfs, bootstrap, Surface e OrdaX Creator.

Regras:

- `CODEX_REQUIRED=NO`;
- `LOCAL_DEVELOPER_TOOLCHAIN_REQUIRED=NO`;
- `MANUAL_KERNEL_BUILD_REQUIRED=NO`;
- GitHub Actions e o executor atual, nao source authority;
- o entrypoint de build deve ser portavel para outro executor/container compativel;
- Codex pode ser parceiro opcional para revisao, investigacao fisica ou segunda opiniao;
- um build que depende de estado local nao documentado e defeito arquitetural.

O ambiente do kernel 6.6.52 ja possui imagem OCI por digest, snapshot APT, 17 versoes exatas de pacotes e prova repetida de hashes identicos. Isso fecha apenas o gate de ambiente reproduzivel; `physical_artifact_authorized` continua separado e fail-closed.

Ver `docs/BUILD-AUTONOMY.md` e `docs/contracts/build-autonomy.json`.

## 8. Desenvolvimento diario

Fluxo normal:

```text
editar source
 -> preview Web/HMR quando aplicavel
 -> testar
 -> commit/push main
 -> CI gera/verifica apenas artefatos afetados
 -> Web/Mobile/Desktop recebem o commit aplicavel
 -> OrdaX USB/Native detecta release ou delta
 -> verifica
 -> ativa
```

No owner/development Git-first, a etapa nativa equivalente pode ser `ordax-pull -> ordax-run`; `ordax-rollback` fixa o commit anterior entre reboots ate um `ordax-pull` explicito.

Nao exigir SSH, shell remoto, Remote Core, Control Plane ou Codex para esse fluxo.

Uma mudanca de Surface nao deve reconstruir kernel. Uma mudanca de kernel nao deve reconstruir Surface sem motivo real de dependencia.

## 9. Independencia do host

A arquitetura nao pode exigir como dependencia obrigatoria:

- WSL;
- QEMU;
- PowerShell;
- Bash;
- distribuicao Linux especifica no host do desenvolvedor;
- sistema desktop especifico;
- executavel SSH externo.

Quando Windows/Linux/macOS exigirem APIs diferentes para disco/elevacao, usar adapters finos sob um core compartilhado. Politica, formato, hashes, layout e comportamento nao podem divergir por host.

Um runner Linux/container pode compilar o kernel Linux no CI. Isso nao torna Linux/WSL uma dependencia da maquina do desenvolvedor.

## 10. Remote/Control opcional

Remote Core e Control Plane sao capacidades futuras opcionais.

Nao implementar ou colocar no bootstrap por antecipacao. So adicionar quando existir requisito concreto de diagnostico remoto, gerenciamento, suporte ou recovery.

Se forem implementados, devem usar transporte/criptografia padrao e auditado. Criptografia customizada e proibida.

## 11. Reuso do repositorio antigo

`novo-ordax-os` e referencia, nao dependencia automatica.

Para portar qualquer componente antigo, registrar em `docs/SOURCE-MIGRATION.md`:

- origem exata;
- commit/SHA;
- responsabilidade;
- por que ainda e necessario;
- dependencias;
- testes;
- decisao: ADOPTED / REIMPLEMENTED / REJECTED / REFERENCE_ONLY.

Nao copiar pastas inteiras, history, tmp, backups, scripts antigos, stack SSH/QEMU/F7 ou contratos obsoletos.

## 12. Seguranca

- Nunca versionar private keys, tokens, secrets ou credenciais.
- Integridade, autorizacao e selecao de alvo falham fechado.
- Operacao destrutiva de disco exige identificacao inequivoca do alvo, dry-run e evidencia.
- Criptografia customizada e proibida.

## 13. Trabalho fisico

Antes de formatar ou escrever em pendrive/notebook:

1. confirmar dispositivo por identidade/capacidade/serial quando disponivel;
2. confirmar que o source da operacao esta na `main`;
3. executar dry-run ou teste descartavel quando aplicavel;
4. registrar o payload minimo exato;
5. registrar o que sera apagado/criado;
6. exigir autorizacao destrutiva explicita no momento da escrita;
7. somente depois aplicar;
8. verificar leitura/hashes/layout depois da escrita.

O token de confirmacao do Creator deve estar ligado a identidade atual do USB, incluindo capacidade fisica medida. Uma autorizacao de escrita RAW deve ainda estar ligada ao SHA-256 e tamanho exato da imagem, e uma imagem de disco completa deve ter exatamente o mesmo tamanho do `PhysicalDrive` confirmado quando esse for o plano ativo.

OrdaX Creator deve consumir artefatos preconstruidos e verificados; o usuario final nao compila kernel para instalar o sistema.

## 14. Qualidade

- SSOT unico por responsabilidade.
- Sem bridges permanentes ou compatibilidade legada sem owner.
- Testes cobrem contratos criticos.
- Documentacao canonica muda junto com arquitetura.
- Platform adapters nao podem duplicar regras de produto.
- Build reproduzivel e provenance sao parte da qualidade, nao tarefas opcionais de release.

## 15. Estado atual

O clean-room ja possui receitas e provas para kernel, initramfs, rede minima, release acquisition, release bundle, Creator Core, descoberta segura de alvo Windows e composicao descartavel de midia. O `system/` real tambem possui um entrypoint compartilhado e bundling deterministico.

O ambiente do kernel esta fechado por prova repetida: imagem OCI por digest, snapshot APT, pacotes fixados e os tres artefatos do kernel reproduziram hashes identicos em execucoes independentes. Esse fato nao autoriza por si so uso fisico.

O owner/development Git-first tambem possui base com Git nativo, rede e firmware selecionado; o runtime usa partial+sparse checkout de `system/`, `git pull --ff-only` e rollback fixado entre reboots ate pull explicito. Isso e um perfil de desenvolvimento e nao substitui a trust canonical signed-release.

O Creator Windows ja mede a capacidade real do `PhysicalDrive`, inclui essa capacidade no token de confirmacao, verifica imagem RAW por tamanho/hash e possui uma autorizacao destrutiva calculada sobre alvo + imagem/plano. O backend nativo Win32 de escrita RAW ja existe e e testado internamente, mas sua autorizacao/publicacao permanece separada dos gates canonicos.

A prova byte-completa com confianca efemera tambem passou para o bootstrap seed. A chave privada efemera e a imagem RAW foram destruidas antes do upload; somente metadados de prova foram preservados. Isso nao substitui confianca canonica e nao autoriza por si so promocao publica.

Ainda permanecem abertos antes da promocao canonical:

```text
canonical Ed25519 release trust ceremony/public anchor
byte-complete proof with canonical public trust
real notebook boot/network/runtime/recovery evidence
graphical shared Surface and remaining product-mode continuity
```

A permissao de escrita fisica deve continuar obedecendo os contratos/gates atuais; nao inferir autorizacao apenas porque o Creator owner/development gera uma imagem ou executavel.

O menor caminho canonical continua:

```text
boot -> rede -> adquirir release assinada -> verificar -> ativar -> boot offline posterior
```

Todo componente extra deve justificar sua existencia antes de entrar no bootstrap.
