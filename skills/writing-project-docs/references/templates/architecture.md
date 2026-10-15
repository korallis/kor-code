# Architecture

## Status and scope

Distinguish confirmed design, proposed design and implemented evidence. Describe
the system boundary and external dependencies using canonical glossary terms.

## Responsibility boundaries

| Component | Owns | Inputs and outputs | Trust boundary |
| --- | --- | --- | --- |
| Project component | Single responsibility and authoritative data | Named interface | Caller and access assumptions |

## Main flow

Trace a primary request or user action across these boundaries, including
persistence and expected failure paths. Reference requirement IDs.

## Invariants

Number the properties that remain true across components and explain where each
is enforced or, for planned work, where enforcement is intended.

## Tradeoffs and decisions

Reference ADR IDs for decisions. Keep unresolved alternatives in open questions;
a proposed architecture does not imply acceptance.
