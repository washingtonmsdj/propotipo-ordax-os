# Nomenclatura de entrega e atualização

Status: CANÔNICO PARA O PROTÓTIPO

Este documento separa os identificadores internos de desenvolvimento dos identificadores que aparecem para quem usa o OrdaX.

## Regra principal

```text
PR do GitHub
  -> mudança de desenvolvimento
  -> merge / commit SHA
  -> classificação do impacto
  -> Entrega OrdaX, somente quando há efeito no dispositivo
  -> aplicação no notebook
  -> Atualização aplicada
```

Um número de PR nunca é o número de uma atualização do notebook.

## Identidades

| Conceito | Exemplo | Uso |
|---|---|---|
| PR | `#155` | revisão e integração de desenvolvimento no GitHub; não é identidade de produto |
| Commit técnico | `68e1380e…` | identidade exata do código-fonte |
| Entrega | `Entrega 74` | sequência humana das mudanças aplicáveis ao dispositivo |
| Aplicação | `Entrega 74 · Aplicada` | registro local de quando aquele notebook aplicou a entrega |
| Versão de produto | futura, por exemplo `OrdaX 1.0` | release comercial/produto; não deve ser inferida de PR nem de entrega |
| Versão de componente | SemVer próprio | identidade do componente; não implica atualização independente |

## Sequência de Entrega

Enquanto o protótipo usa a `main` como fonte de atualização do notebook, o número de Entrega é derivado da sequência first-parent de mudanças que realmente atingem o dispositivo.

A sequência atual tem uma âncora explícita: o commit `2361b9e7…` é **Entrega 220**. Depois dessa âncora, contam mudanças em `system/`, `boot/` e `bootstrap/`, mas não contam:

- arquivos Markdown nesses owners;
- scripts `prove_*` usados apenas para evidência/CI em `boot/` ou `bootstrap/`;
- site público, documentação geral, testes, CI ou compliance sem efeito nos bytes/runtime do notebook.

A âncora preserva os números que já haviam sido observados fisicamente enquanto permite tornar a classificação mais precisa sem renumerar o histórico exibido ao usuário. Uma prova de CI não cria uma Entrega e também não deve marcar um novo boot como necessário.

A sequência não usa número de Pull Request.

O SHA continua sendo a identidade técnica exata. O número de Entrega existe apenas para leitura humana e histórico.

## Atualização

“Atualização” é o ato/estado no dispositivo, não um objeto do GitHub.

Exemplos:

```text
Entrega 74 disponível
Atualizando…
Entrega 74 aplicada
Entrega 74 revertida
```

Uma mudança em `sites/public/` pode avançar a `main` sem produzir uma nova Entrega para o notebook.

## Componentes

Enquanto Surface, Arquivos, Ajustes, Conta, Sistema, Rede e Atualizador forem distribuídos no mesmo pacote do sistema, eles não devem repetir artificialmente o número da Entrega como se fosse uma versão própria.

A UI pode dizer:

```text
Surface      v0.1.0 · distribuição conjunta
Arquivos     v0.1.0 · distribuição conjunta
Conta        v0.1.0 · distribuição conjunta
```

Cada componente possui uma versão declarada no manifesto canônico. A independência de atualização é outro eixo: `bundled` acompanha a entrega conjunta, `component-slot` possui `current/previous/pending` e rollback individual, e `base-ab` pertence exclusivamente à Base crítica. Não inferir independência apenas porque existe um número de versão.

## Compatibilidade do contrato atual

O campo legado `versionNumber` de `ordax.update-status/1` e `ordax.update-history/1` permanece temporariamente como alias de compatibilidade. A UI e o novo código usam `deliveryNumber`.

Nenhum código novo deve interpretar `versionNumber` como número de PR ou como versão comercial do OrdaX.
