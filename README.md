# Prototipo OrdaX OS

Clean-room experimental para validar uma arquitetura OrdaX OS mais simples antes de qualquer substituicao do repositorio atual.

> **Status:** PROTOTIPO / NAO PROMOVIDO
>
> Este repositorio nao substitui `washingtonmsdj/novo-ordax-os` enquanto os gates fisicos definidos em `docs/PROMOTION-GATES.md` nao forem aprovados.

## Objetivo

Construir uma base minima, reproduzivel e Git-first que consiga:

1. inicializar por UEFI;
2. subir kernel + initramfs minimos;
3. disponibilizar rede, identidade e acesso remoto seguro;
4. alcancar Git;
5. materializar releases versionadas no dispositivo;
6. evoluir o sistema no notebook por delta, sem reflashear o pendrive a cada alteracao.

## Principios

- `main` e a autoridade de source deste prototipo.
- O pendrive e alvo materializado, nao source authority.
- O layout fisico alvo possui apenas duas particoes: `ORDAX-ESP` + `ORDAX`.
- HOME e estado de usuario sao separacoes logicas dentro de `ORDAX`, nao uma terceira particao obrigatoria.
- Antes do Git deve existir somente o substrato necessario para boot, rede, identidade, acesso remoto, recuperacao e aquisicao da release.
- Nada do repositorio antigo entra aqui por copia em massa. Cada componente herdado precisa de origem, finalidade e validacao explicitas.
- Segredos, chaves privadas e credenciais nunca sao versionados.
- Operacoes destrutivas em midia fisica exigem gates e evidencia antes da escrita.

## Entrada obrigatoria para humanos e IAs

Leia, nesta ordem:

1. `AGENTS.md`
2. `docs/CURRENT-STATE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PHYSICAL-MEDIA.md`
5. `docs/DEVELOPMENT-WORKFLOW.md`
6. `docs/SOURCE-MIGRATION.md`
7. `docs/PROMOTION-GATES.md`
8. `docs/DECISIONS.md`

`CURRENT-STATE.md` e o snapshot de handoff. Os demais documentos definem os contratos duraveis e vencem em caso de conflito.

## Estrutura alvo

```text
boot/
  esp/                 # arquivos da ESP produzidos/validados pelo source
bootstrap/
  kernel/
  initramfs/
  network/
  identity/
  remote/
  control-plane/
  git/
  recovery/
platform/
  releases/            # materializacao versionada; nao source runtime mutavel
  state/               # contrato de estado persistente
  home/                # contrato logico de dados de usuario
tools/
  provision/
  dev/
  verify/
tests/
docs/
```

Diretorios vazios sao representados por `.gitkeep` somente enquanto ainda nao possuem implementacao real.

## Regra de promocao

Este repositorio so pode ser promovido a sucessor oficial depois de provar no hardware real:

`UEFI -> boot -> kernel/initramfs -> rede -> identidade -> SSH/Remote Core -> Git -> release/<commit> -> current -> atualizacao incremental`.

Ate la, `novo-ordax-os` permanece intacto como referencia e fallback.
