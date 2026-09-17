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

Para geometria fisica, os contratos vencem texto descritivo:

- `docs/contracts/physical-media.json` = seed bootstrap independente de capacidade;
- `docs/contracts/physical-prepared-media.json` = USB fisico final depois do Creator.

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

Quando um snapshot historico conflitar com `docs/ARCHITECTURE.md` e os contratos fisicos atuais, os contratos arquiteturais atuais vencem para geometria e comportamento materializado.

## 4. Arquitetura fisica alvo

Ha dois artefatos distintos:

```text
BOOTSTRAP_SEED_PARTITIONS=2
SEED_PARTITION_1=ORDAX-ESP
SEED_PARTITION_2=ORDAX

PREPARED_USB_PARTITIONS=3
PREPARED_PARTITION_1=ORDAX-ESP
PREPARED_PARTITION_2=ORDAX
PREPARED_PARTITION_3=ORDAX-DATA

SEPARATE_HOME_PARTITION=NO
```

`ORDAX-DATA` e criado pelo Creator porque depende da capacidade real do alvo. Ele nao faz parte do seed assinado/capacity-independent. Nao reintroduzir `ORDAX-HOME` nem `ORDAX-PLATFORM`.

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

## 6. Dois perfis de aquisicao, uma source authority

### Owner/development Git-first

```text
UEFI
 -> kernel/initramfs
 -> development base
 -> drivers/firmware
 -> rede
 -> Git
 -> partial+sparse checkout da main em /workspace/ordax
 -> system/entrypoint
```

Regras:

- Git fica fisicamente no development base;
- checkout completo nao e preseeded;
- clone inicial usa filtro parcial e sparse checkout de `system/`;
- atualizacao usa `git pull --ff-only`;
- alteracao local, origin inesperado ou branch inesperada bloqueiam pull;
- rollback permanece fixado entre reboots ate `ordax-pull` explicito;
- mudanca normal em `system/` nao exige regravar USB nem recompilar kernel.

### Canonical signed-release

```text
UEFI
 -> kernel/initramfs
 -> bootstrap minimo
 -> rede minima
 -> aquisicao de release assinada
 -> verificacao
 -> /ordax/releases/<commit>
 -> /ordax/current
```

Confianca efemera de CI/desenvolvimento nunca substitui a trust canonica.

Nao sao obrigatorios no bootstrap comum:

- SSH;
- OrdaX Remote Core;
- Control Plane;
- servico de identidade persistente;
- Surface/desktop preinstalado;
- apps normais;
- checkout completo do source;
- toolchain de build;
- WSL/QEMU;
- dump do repositorio antigo.

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

## 8. Desenvolvimento diario

Fluxo owner/development:

```text
editar source
 -> testar
 -> commit/push main
 -> ordax-pull
 -> ordax-run
```

Fluxo canonical release:

```text
editar source
 -> testar
 -> commit/push main
 -> CI gera/verifica artefatos afetados
 -> publica release assinada
 -> dispositivo verifica
 -> ativa
```

Nao exigir SSH, shell remoto, Remote Core, Control Plane ou Codex para esses fluxos.

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
- Confianca efemera de prototipo deve permanecer explicitamente separada da trust canonica.

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

O token de confirmacao do Creator deve estar ligado a identidade atual do USB, incluindo capacidade fisica medida. Uma autorizacao de escrita RAW deve ainda estar ligada ao SHA-256 e tamanho exato da imagem/plano de escrita correspondente.

OrdaX Creator deve consumir artefatos preconstruidos e verificados; o usuario final nao compila kernel para instalar o sistema.

## 14. Qualidade

- SSOT unico por responsabilidade.
- Sem bridges permanentes ou compatibilidade legada sem owner.
- Testes cobrem contratos criticos.
- Documentacao canonica muda junto com arquitetura.
- Platform adapters nao podem duplicar regras de produto.
- Build reproduzivel e provenance sao parte da qualidade, nao tarefas opcionais de release.
- Nao confundir seed de 2 particoes com USB final preparado de 3 particoes.
- Nao confundir owner Git-first com canonical signed-release.

## 15. Estado atual

O owner/development Git-first base ja foi provado em CI com boot ESP, kernel, initramfs, modulos/firmware selecionados, rede e Git nativo. O checkout de runtime e partial+sparse (`system/`) e o rollback e persistente entre reboots ate um `ordax-pull` explicito.

O Creator owner/development ja materializa e verifica o RAW e publica um executavel de desenvolvimento com trust efemera explicitamente separada da trust canonica.

Ainda permanecem gates distintos antes de promocao publica/canonica, incluindo trust Ed25519 controlada pelo usuario e evidencia real de boot/rede/runtime/recovery no notebook.

Todo componente extra deve justificar sua existencia antes de entrar no bootstrap.
