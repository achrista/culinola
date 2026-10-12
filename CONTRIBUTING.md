# Contributing

Thank you for wanting to improve Culinola. Bug reports and ideas are welcome as [issues](https://github.com/achrista/culinola/issues); code is welcome as pull requests.

## Contributor License Agreement

Before a pull request can be merged, its author has to agree to the [Contributor License Agreement](CLA.md) once. Culinola is published under the [PolyForm Noncommercial License](LICENSE), and its maintainer may also license it commercially. The agreement lets your contribution be part of both; you keep all rights to your own work.

A bot asks for this on your first pull request. You agree by posting the comment it suggests:

> I have read the CLA Document and I hereby sign the CLA

## Tests

Every change has to pass `npm run check` (type check, tests, licence check). What else has to be checked and which tests belong to new code is described in [docs/testen.md](docs/testen.md) (German for now).

## Language

The interface is German and English; every text of the interface needs both. Code comments, commit messages and the messages of the core are German at present – contributions in English are fine.

## Rules for dependencies

Only permissively licensed packages are allowed: MIT, MIT-0, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Unlicense, CC0-1.0, and OFL-1.1 for fonts.

Not allowed: GPL, AGPL, linked LGPL, SSPL, BUSL, licences restricted to non-commercial use, and packages without a clear licence.

`npm run licenses` checks this for all shipped dependencies and fails on a violation.

## What never belongs in the repository

Credentials, keys, tokens, private addresses, and images, sounds or fonts with unclear rights.
