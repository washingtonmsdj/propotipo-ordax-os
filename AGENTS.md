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

## 3. Ordem obrigatoria de leitura

Antes de alterar codigo, contratos ou midia:

1. `README.md`
2. `docs/CURRENT-STATE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PRODUCT-MODES.md`
5. `docs/MINIMAL-USB-BOOTSTRAP.md`
6. `docs/HOST-INDEPENDENCE.md`
7. `docs/REMOTE-CONTROL.md`
8. `docs/PHYSICAL-MEDIA.md`
9. `docs/DEVELOPMENT-WORKFLOW.md`
10. `docs/SOURCE-MIGRATION.md`
11. `docs/PROMOTION-GATES.md`
12. `docs/DECISIONS.md`

## 4. Arquitetura fisica alvo

```text
PHYSICAL_PARTITIONS=2
ESP=ORDAX-ESP
MAIN=ORDAX
SEPARATE_HOME_PARTITION=NO
```

Nao reintroduzir uma terceira particao HOME sem uma decisao arquitetural registrada.

## 5. Um produto, tres modos

```text
OrdaX Web
 -> OrdaX USB
 -> OrdaX Native (SSD/HD)
```

Web, USB e instalacao nativa sao modos do mesmo produto, nao forks.

Surface, apps e logica compartilhada possuem uma unica fonte em `system/`. Diferencas de ambiente vivem apenas em adapters de capacidade.

## 6. Pendrive inicial minimo

O primeiro USB deve conter apenas o necessario para chegar a uma release confiavel pela rede:

```text
UEFI
 -> bootloader
 -> kernel/initramfs
 -> bootstrap minimo
 -> rede minima
 -> aquisicao de release via Git/GitHub
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

Depois do primeiro boot, a release completa deve ser adquirida, verificada e materializada em `/ordax/releases/<commit>`. Uma release conhecida deve permanecer local para boot offline e rollback.

## 7. Desenvolvimento diario

Fluxo normal:

```text
editar source
 -> preview Web/HMR quando aplicavel
 -> testar
 -> commit/push em main
 -> Web recebe o mesmo commit
 -> OrdaX detecta/puxa release ou delta
 -> verifica
 -> ativa
```

Nao exigir SSH, shell remoto, Remote Core ou Control Plane para esse fluxo.

## 8. Independencia do host

A arquitetura nao pode exigir como dependencia obrigatoria:

- WSL;
- QEMU;
- PowerShell;
- Bash;
- distribuicao Linux especifica;
- sistema desktop especifico;
- executavel SSH externo.

Quando Windows/Linux/macOS exigirem APIs diferentes para disco/elevacao, usar adapters finos sob um core compartilhado. Politica, formato, hashes, layout e comportamento nao podem divergir por host.

## 9. Remote/Control opcional

Remote Core e Control Plane sao capacidades futuras opcionais.

Nao implementar ou colocar no bootstrap por antecipacao. So adicionar quando existir requisito concreto de diagnostico remoto, gerenciamento, suporte ou recovery.

Se forem implementados, devem usar transporte/criptografia padrao e auditado. Criptografia customizada e proibida.

## 10. Reuso do repositorio antigo

`novo-ordax-os` e referencia, nao dependencia automatica.

Para portar qualquer componente antigo, registrar em `docs/SOURCE-MIGRATION.md`:

- origem exata;
- commit/SHA;
- responsabilidade;
- por que ainda e necessario;
- dependencias;
- testes;
- decisao: ADOPTED / REIMPLEMENTED / REJECTED.

Nao copiar pastas inteiras, history, tmp, backups, scripts antigos, stack SSH/QEMU/F7 ou contratos obsoletos.

## 11. Seguranca

- Nunca versionar private keys, tokens, secrets ou credenciais.
- Integridade, autorizacao e selecao de alvo falham fechado.
- Operacao destrutiva de disco exige identificacao inequivoca do alvo, dry-run e evidencia.
- Criptografia customizada e proibida.

## 12. Trabalho fisico

Antes de formatar ou escrever em pendrive/notebook:

1. confirmar dispositivo por identidade/capacidade/serial quando disponivel;
2. confirmar que o source da operacao esta na `main`;
3. executar dry-run ou teste descartavel quando aplicavel;
4. registrar o payload minimo exato;
5. registrar o que sera apagado/criado;
6. somente depois aplicar;
7. verificar leitura/hashes/layout depois da escrita.

## 13. Qualidade

- SSOT unico por responsabilidade.
- Sem bridges permanentes ou compatibilidade legada sem owner.
- Testes cobrem contratos criticos.
- Documentacao canonica muda junto com arquitetura.
- Platform adapters nao podem duplicar regras de produto.

## 14. Estado atual

Kernel/initramfs e provisioning ainda nao foram implementados no clean-room. O primeiro objetivo e provar o menor caminho possivel:

```text
boot -> rede -> adquirir release do Git/GitHub -> verificar -> ativar -> boot offline posterior
```

Todo componente extra deve justificar sua existencia antes de entrar no bootstrap.
