# Prototipo OrdaX OS

Clean-room experimental para validar uma arquitetura OrdaX OS mais simples antes de substituir qualquer base atual.

> **Status:** PROTOTIPO / NAO PROMOVIDO
>
> Este repositorio nao substitui `washingtonmsdj/novo-ordax-os` enquanto os gates definidos em `docs/PROMOTION-GATES.md` nao forem aprovados.

## Objetivo

Construir uma unica OrdaX, reproduzivel e Git-first, em tres modos:

```text
OrdaX Web
 -> OrdaX USB
 -> OrdaX Native (SSD/HD)
```

Todos compartilham a mesma Surface, apps e logica de produto. O modo nativo apenas acrescenta capacidades de kernel/hardware por adapters.

## Principios

- `main` e a source authority.
- Pendrive/notebook sao alvos materializados.
- Codex e parceiro opcional, nunca requisito de source/build/release.
- Builds devem nascer de receitas versionadas + ambiente fixado + CI + provenance/hash.
- Kernel nao e excecao manual: deve ser compilado pelo pipeline canonico, nao pela maquina do desenvolvedor.
- Layout fisico: `ORDAX-ESP` + `ORDAX`.
- HOME e estado de usuario sao logicos, nao uma terceira particao obrigatoria.
- O primeiro USB e minimo: boot + kernel/initramfs + rede + aquisicao/verificacao de release + recovery.
- SSH, Remote Core e Control Plane nao sao requisitos do bootstrap nem do desenvolvimento diario.
- Surface, apps e sistema de alto nivel chegam depois por release.
- Depois da primeira release verificada, ela permanece local para boot offline e rollback.
- Web, USB e SSD/HD sao modos do mesmo produto, nao forks.
- Surface e apps possuem uma unica arvore source.
- WSL, QEMU, PowerShell, Bash e SSH externo nao sao dependencias arquiteturais obrigatorias.
- Nada do repositorio antigo entra por copia em massa.
- Segredos/chaves privadas nunca sao versionados.
- Criptografia caseira e proibida.
- Escrita fisica exige gates e evidencia.

## Entrada obrigatoria

Leia:

1. `AGENTS.md`
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

## Estrutura alvo

```text
boot/
  esp/
bootstrap/
  kernel/
  initramfs/
  network/
  git/                   # release acquisition/update
  recovery/
  identity/              # opcional futuro
  remote/                # opcional futuro
  control-plane/         # opcional futuro
system/
  surface/
  apps/
  services/
  adapters/
    web/
    native/
platform/
  releases/
  state/
  home/
tools/
  creator/
  dev/
  verify/
tests/
docs/
```

## Build autonomo

```text
alteracao em main
 -> receita versionada
 -> CI em ambiente fixado
 -> build apenas do afetado
 -> testes
 -> provenance + SHA-256
 -> artefato/release
```

O objetivo e que eu, outra IA ou qualquer desenvolvedor consiga manter o projeto apenas pelo repositorio e pelo pipeline canonico. Nenhum passo pode exigir Codex especificamente.

GitHub Actions e o executor atual, mas nao e source authority. O entrypoint de build deve continuar portavel para outro runner/container compativel.

## Pendrive inicial

```text
USB inicial
 -> boot
 -> rede
 -> buscar release exata no Git/GitHub
 -> verificar
 -> releases/<commit>
 -> current
 -> OrdaX completa
```

Nao gravar o sistema completo no pendrive inicial por conveniencia. Quase toda evolucao posterior acontece por Git/rede.

## Desenvolvimento

```text
editar
 -> preview Web/HMR
 -> testar
 -> commit/push main
 -> CI gera/verifica o afetado
 -> Web recebe a mudanca
 -> OrdaX recebe release/delta correspondente
 -> verifica
 -> ativa
```

Sem SSH, shell remoto ou Codex como requisito.

## Instalacao

```text
OrdaX Web
 -> baixar OrdaX Creator
 -> criar USB minimo
 -> bootar OrdaX
 -> adquirir/sincronizar ambiente
 -> opcionalmente instalar no SSD/HD
```

O usuario final nao deve precisar de WSL, QEMU ou toolchain de kernel. O Creator consome artefatos ja compilados e verificados pelo pipeline.

## Regra de promocao

O sucessor oficial precisa provar no hardware real:

```text
source/build sem Codex
 -> kernel/initramfs reproduziveis no CI
 -> UEFI
 -> rede
 -> aquisicao/verificacao de release
 -> release/<commit>
 -> current
 -> boot offline conhecido-bom
 -> Surface compartilhada
 -> atualizacao Git-driven
 -> continuidade Web/USB/Native
```

Ate la, `novo-ordax-os` permanece como referencia.
