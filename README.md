# Prototipo OrdaX OS

Clean-room experimental para validar uma arquitetura OrdaX OS simples, reproduzivel e Git-first antes de substituir qualquer base atual.

> **Status:** PROTOTIPO / NAO PROMOVIDO
>
> Este repositorio nao substitui `washingtonmsdj/novo-ordax-os` enquanto os gates de `docs/PROMOTION-GATES.md` nao forem aprovados.

## Plano funcional da interface

O [PLANO-FUNCIONAL-SURFACE-E-APPS.md](PLANO-FUNCIONAL-SURFACE-E-APPS.md), na raiz, detalha a area de trabalho e os apps **Arquivos, Ajustes, Conta e Sistema**: cada subsecao, conteudo, comportamento, recursos existentes, lacunas e ordem de implementacao. IAs e desenvolvedores devem le-lo junto das instrucoes de `AGENTS.md` antes de trabalhar nessas interfaces. O plano e uma proposta; revalide seu inventario contra a `main` atual e preserve os contratos canonicos.

## Um produto, cinco modos

```text
OrdaX Web
 -> OrdaX Mobile (Android / iPhone)
 -> OrdaX Desktop
 -> OrdaX USB
 -> OrdaX Native (SSD/HD)
```

Todos usam uma identidade OrdaX, a mesma Surface/app source onde aplicavel e sincronizacao segura de estado suportado. Diferencas de ambiente ficam atras de adapters de capacidade, nao em forks de produto.

## Principios

- `main` e a source authority.
- Pendrive/notebook sao alvos materializados.
- Codex e parceiro opcional, nunca requisito de source/build/release/instalacao.
- Builds nascem de receitas versionadas + CI + provenance/hash.
- Kernel e initramfs sao artefatos normais do pipeline canonico.
- Layout fisico: exatamente `ORDAX-ESP` + `ORDAX`.
- HOME e estado de usuario sao logicos, nao uma terceira particao.
- O primeiro USB e minimo: boot + kernel/initramfs + rede + aquisicao/verificacao de release + recovery.
- SSH, Remote Core e Control Plane nao sao requisitos do bootstrap nem do desenvolvimento diario.
- WSL, QEMU e toolchains locais nao sao requisitos do usuario final.
- Nada do repositorio antigo entra por copia em massa.
- Segredos/chaves privadas nunca sao versionados.
- Criptografia caseira e proibida.
- Escrita fisica exige gates, hashes, identidade de target e autorizacao explicita.

## Leia primeiro

1. `AGENTS.md`
2. `docs/CURRENT-STATE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/BUILD-AUTONOMY.md`
5. `docs/PRODUCT-MODES.md`
6. `docs/ACCOUNT-SYNC-AND-PLANS.md`
7. `docs/MINIMAL-USB-BOOTSTRAP.md`
8. `docs/CREATOR-INSTALLATION.md`
9. `docs/HOST-INDEPENDENCE.md`
10. `docs/REMOTE-CONTROL.md`
11. `docs/PHYSICAL-MEDIA.md`
12. `docs/DEVELOPMENT-WORKFLOW.md`
13. `docs/RELEASE-CHANNEL.md`
14. `docs/SOURCE-MIGRATION.md`
15. `docs/PROMOTION-GATES.md`
16. `docs/DECISIONS.md`

## Estrutura principal

```text
boot/
  esp/
bootstrap/
  kernel/
  initramfs/
  network/
  release-acquisition/
  recovery/
system/
  surface/
  apps/
  services/
  adapters/
    web/
    mobile/
    desktop/
    native/
platform/
  releases/
  state/
  home/
tools/
  creator/
    core/
    cmd/ordax-creator/
    platform/
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

O objetivo e que ChatGPT, outra IA ou qualquer desenvolvedor mantenha o projeto pelo repositorio e pipeline canonico sem depender de Codex especificamente.

## Pendrive inicial

```text
USB minimo
 -> UEFI
 -> kernel/initramfs
 -> /ordax/bootstrap/entrypoint
 -> se current conhecido existe: boot offline
 -> senao: rede minima
 -> release HTTPS assinada
 -> verificar
 -> releases/<commit>
 -> current
 -> OrdaX completa
```

## Instalacao sem Codex

O caminho permanente e o Creator como capacidade do OrdaX Desktop:

```text
OrdaX Desktop
 -> Creator Core
 -> adapter/helper Windows estreito
 -> USB OrdaX verificado
```

Para nao bloquear os primeiros testes fisicos esperando o Desktop completo, o CI pode publicar antes um pequeno `ordax-creator.exe`. Ele usa exatamente o mesmo Creator Core e depois desaparece como shell separado quando a interface Desktop assumir a funcao.

O Creator nao compila kernel no Windows. Ele consome artefatos ja gerados e verificados pelo CI.

Estado atual:

```text
Creator CHECK=IMPLEMENTED
Creator PLAN=FAIL_CLOSED_ENQUANTO_MANIFESTO_NAO_AUTORIZADO
Creator APPLY=NAO_IMPLEMENTADO
PHYSICAL_USB_WRITE=NO
```

## Desenvolvimento

```text
editar
 -> preview Web/HMR
 -> testar
 -> commit/push main
 -> CI gera/verifica o afetado
 -> Web/Mobile/Desktop recebem o commit aplicavel
 -> OrdaX USB/Native recebe release/delta verificado
```

## Promocao

O sucessor oficial precisa provar no hardware real:

```text
source/build sem Codex
 -> kernel/initramfs reproduziveis
 -> Creator seguro
 -> duas particoes exatas
 -> UEFI
 -> rede
 -> aquisicao/verificacao de release
 -> current conhecido-bom
 -> boot offline
 -> Surface compartilhada
 -> atualizacao Git-driven
 -> continuidade Web/Mobile/Desktop/USB/Native
```

Ate la, `novo-ordax-os` permanece somente como referencia/evidencia.
