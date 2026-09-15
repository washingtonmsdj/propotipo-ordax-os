# AGENTS.md

Este arquivo e a entrada obrigatoria para qualquer IA, agente, Codex ou pessoa que trabalhe neste repositorio.

## 1. Identidade do repositorio

`propotipo-ordax-os` e uma **clean-room experimental**. Ele existe para provar uma arquitetura OrdaX OS simplificada sem contaminar nem depender estruturalmente de `washingtonmsdj/novo-ordax-os`.

Nao trate este repositorio como sucessor oficial enquanto `docs/PROMOTION-GATES.md` nao estiver integralmente aprovado.

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
5. `docs/HOST-INDEPENDENCE.md`
6. `docs/REMOTE-CONTROL.md`
7. `docs/PHYSICAL-MEDIA.md`
8. `docs/DEVELOPMENT-WORKFLOW.md`
9. `docs/SOURCE-MIGRATION.md`
10. `docs/PROMOTION-GATES.md`
11. `docs/DECISIONS.md`

## 4. Arquitetura fisica alvo

```text
PHYSICAL_PARTITIONS=2
ESP=ORDAX-ESP
MAIN=ORDAX
SEPARATE_HOME_PARTITION=NO
```

Nao reintroduzir uma terceira particao HOME sem uma decisao arquitetural registrada em `docs/DECISIONS.md` com motivo e impacto.

## 5. Um produto, tres modos

```text
OrdaX Web
 -> OrdaX USB
 -> OrdaX Native (SSD/HD)
```

Web, USB e instalacao nativa sao modos de capacidade do mesmo produto, nao forks.

A Surface, apps e logica compartilhada devem ter uma unica fonte em `system/`. Diferencas de ambiente vivem somente em adapters de capacidade.

E proibido criar implementacoes visuais separadas para Web e dispositivo.

## 6. Cadeia minima antes do Git

Somente o necessario para atingir uma release versionada pode existir como bootstrap persistente:

```text
UEFI
 -> bootloader
 -> kernel/initramfs
 -> rede minima
 -> identidade do dispositivo
 -> OrdaX Remote Core
 -> Control Plane minimo
 -> cliente Git / aquisicao de release
 -> releases/<commit>
 -> current
```

Desktop, UI completa, apps e servicos de alto nivel devem chegar por release, nao ser embutidos arbitrariamente no bootstrap.

## 7. Independencia do host

A arquitetura nao pode exigir como dependencia obrigatoria:

- WSL;
- QEMU;
- PowerShell;
- Bash;
- uma distribuicao Linux especifica;
- um sistema desktop especifico;
- um executavel SSH externo.

Quando Windows/Linux/macOS exigirem APIs diferentes para disco, elevacao ou integracao, usar adapters finos sob um core compartilhado. Politica, formato, hashes, layout e comportamento nao podem divergir por host.

QEMU pode ser usado opcionalmente para testes, nunca como dependencia do produto ou source authority.

## 8. Remote/Control Core

O acesso remoto principal deve ser OrdaX-owned e estruturado.

- nao depender de `ssh.exe` como produto;
- nao usar shell remoto irrestrito como caminho principal;
- preferir RPC de capacidades, streaming de logs/eventos, transferencia de delta e operacoes de release;
- usar transporte seguro e criptografia padrao/auditada;
- nunca criar cifra, troca de chaves ou assinatura criptografica caseira;
- chaves privadas permanecem locais e nunca entram no Git.

SSH pode existir temporariamente somente como break-glass durante a migracao ate o Remote Core provar recuperacao equivalente em hardware real.

## 9. Reuso do repositorio antigo

`novo-ordax-os` e uma referencia, nao uma dependencia automatica.

Para portar qualquer componente antigo, registrar em `docs/SOURCE-MIGRATION.md`:

- origem exata;
- commit/SHA de origem;
- responsabilidade;
- por que ainda e necessario;
- dependencias;
- testes executados;
- decisao: ADOPTED / REIMPLEMENTED / REJECTED.

Nao copiar pastas inteiras, history, tmp, backups, scripts de diagnostico antigos ou contratos obsoletos.

## 10. Seguranca

- Nunca versionar private keys, tokens, secrets ou credenciais.
- Identidade, integridade e autorizacao falham fechado.
- Multiplas autorizacoes publicas de operador/dispositivo podem coexistir.
- Operacao destrutiva de disco exige identificacao inequivoca do alvo, dry-run e evidencia.
- Criptografia customizada e proibida.

## 11. Trabalho fisico

Antes de formatar ou escrever em pendrive/notebook:

1. confirmar dispositivo por identidade/capacidade/serial quando disponivel;
2. confirmar que o source da operacao esta na `main`;
3. executar dry-run ou teste descartavel quando aplicavel;
4. registrar o que sera apagado/criado;
5. somente depois aplicar;
6. verificar leitura/hashes/layout depois da escrita.

Nunca corrigir um layout antigo por impulso se a arquitetura alvo exige reprovisionamento limpo.

## 12. Desenvolvimento diario esperado

```text
editar source
 -> testar afetado
 -> preview Web/HMR quando aplicavel
 -> commit em main
 -> materializar/sincronizar delta no target
 -> reiniciar somente o owner afetado
 -> health/readiness
 -> evidencia
```

Nao reconstruir imagem completa, reflashear pendrive ou reiniciar notebook por padrao quando uma atualizacao incremental for suficiente.

## 13. Qualidade

- Preferir SSOT unico por responsabilidade.
- Sem bridges permanentes, aliases silenciosos ou compatibilidade legada sem owner.
- Testes devem cobrir contratos criticos, nao apenas happy path.
- Documentacao canonica deve ser atualizada junto com mudancas arquiteturais.
- Platform adapters nao podem duplicar regras de produto.

## 14. Estado atual

O repositorio esta em fase de fundacao arquitetural e migracao seletiva. Kernel/initramfs ainda nao foram implementados no clean-room. O antigo initramfs nao deve ser copiado porque carrega responsabilidades do layout antigo.

O proximo trabalho seguro e construir contratos e implementacoes minimas novas, validando cada responsabilidade sem importar lixo ou legados do repositorio anterior.
