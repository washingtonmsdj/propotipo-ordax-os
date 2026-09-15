# Prototipo OrdaX OS

Clean-room experimental para validar uma arquitetura OrdaX OS mais simples antes de qualquer substituicao do repositorio atual.

> **Status:** PROTOTIPO / NAO PROMOVIDO
>
> Este repositorio nao substitui `washingtonmsdj/novo-ordax-os` enquanto os gates definidos em `docs/PROMOTION-GATES.md` nao forem aprovados.

## Objetivo

Construir uma unica OrdaX, reproduzivel e Git-first, capaz de existir em tres modos de capacidade:

```text
OrdaX Web
 -> OrdaX USB
 -> OrdaX Native (SSD/HD)
```

Todos compartilham a mesma Surface, apps e logica de produto. O modo nativo adiciona capacidades de kernel/hardware por adapters, nao por uma segunda interface.

## Principios

- `main` e a autoridade de source deste prototipo.
- O pendrive/notebook sao alvos materializados, nao source authority.
- O layout fisico alvo possui apenas duas particoes: `ORDAX-ESP` + `ORDAX`.
- HOME e estado de usuario sao separacoes logicas dentro de `ORDAX`, nao uma terceira particao obrigatoria.
- Antes do Git deve existir somente o substrato necessario para boot, rede, identidade, OrdaX Remote Core, recuperacao e aquisicao da release.
- Web, USB e SSD/HD sao modos do mesmo produto, nao forks.
- Surface e apps possuem uma unica arvore source.
- WSL, QEMU, PowerShell, Bash e SSH externo nao sao dependencias arquiteturais obrigatorias.
- Nada do repositorio antigo entra aqui por copia em massa. Cada componente herdado precisa de origem, finalidade e validacao explicitas.
- Segredos, chaves privadas e credenciais nunca sao versionados.
- Criptografia caseira e proibida; usar primitivas e transportes maduros/auditados.
- Operacoes destrutivas em midia fisica exigem gates e evidencia antes da escrita.

## Entrada obrigatoria para humanos e IAs

Leia, nesta ordem:

1. `AGENTS.md`
2. `docs/CURRENT-STATE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PRODUCT-MODES.md`
5. `docs/HOST-INDEPENDENCE.md`
6. `docs/REMOTE-CONTROL.md`
7. `docs/PHYSICAL-MEDIA.md`
8. `docs/DEVELOPMENT-WORKFLOW.md`
9. `docs/SOURCE-MIGRATION.md`
10. `docs/PROMOTION-GATES.md`
11. `docs/DECISIONS.md`

`CURRENT-STATE.md` e o snapshot de handoff. Os demais documentos definem contratos duraveis e vencem em caso de conflito.

## Estrutura alvo

```text
boot/
  esp/                   # definicao/material de boot
bootstrap/
  kernel/
  initramfs/
  network/
  identity/
  remote/                # OrdaX Remote Core
  control-plane/
  git/
  recovery/
system/
  surface/               # uma unica Surface para Web + nativo
  apps/                  # uma unica fonte de apps
  services/
  adapters/
    web/
    native/
platform/
  releases/              # contrato de materializacao versionada
  state/                 # estado persistente local
  home/                  # dados de usuario locais/sincronizaveis por politica
tools/
  creator/               # OrdaX Creator: USB/SSD sem WSL
  dev/
  verify/
tests/
docs/
```

## Modelo de instalacao

O usuario pode iniciar na Web e, quando quiser mais capacidade:

```text
OrdaX Web
 -> baixar OrdaX Creator
 -> criar USB
 -> bootar OrdaX
 -> sincronizar ambiente
 -> opcionalmente instalar no SSD/HD
```

O usuario final nao deve precisar instalar WSL, QEMU ou toolchain de kernel para isso.

## Regra de promocao

Este repositorio so pode ser promovido a sucessor oficial depois de provar no hardware real:

```text
UEFI
 -> boot
 -> kernel/initramfs
 -> rede
 -> identidade
 -> OrdaX Remote Core
 -> Git
 -> release/<commit>
 -> current
 -> Surface compartilhada
 -> atualizacao incremental
 -> continuidade Web/USB/Native
```

Ate la, `novo-ordax-os` permanece intacto como referencia e fallback.
