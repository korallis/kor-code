# Domain glossary

This glossary fixes the nouns and verbs used by Kor Code.

## Agent

A software worker that carries out an assigned engineering task under a Jev execution.

## Account slot

One authenticated provider entitlement that can serve model requests.

## Assignment

The link between a Linear issue and the Jev execution responsible for completing it.

## Decision

A structured judgement that selects an action, such as a model, agent, skill, context package, retry, or escalation.

## Decision plane

The part of Kor Code that makes decisions while other systems execute those decisions.

## Execution

One bounded run of Jev Code for a Linear issue. An execution can contain one or more agent sessions.

## Evidence

An observable result that supports a claim about work, such as a test result, CI check, review finding, or provider response.

## Failover

The change from an unavailable account or provider path to another eligible account or provider path.

## Intent

The outcome, constraints, and acceptance conditions expressed by a person in Linear.

## Jev

The decision service at the centre of Kor Code. Jev evaluates structured questions and returns decisions, scores, or yes-or-no probabilities.

## Jev Code

The complete Linear-native engineering agent. It includes the controller, Jev decision core, execution runtime, policy layer, and reporting integration.

## Linear project

The persistent workspace for one product or application. It groups intent, issues, documents, milestones, and delivery history.

## Model route

The selected model family, reasoning level, provider path, and account policy for one request.

## Provider

A model service or subscription family, such as Claude, ChatGPT, Grok, or Devin.

## Session

A live interaction between an agent and an execution runtime. A session has one repository, one branch or worktree, and one execution owner.

## Subscription pool

The set of account slots that Kor Code may use under an explicit routing policy.

## Verification

The process that compares an execution result with issue acceptance conditions and gathers evidence.

## Worktree

An isolated Git checkout that lets one agent change a repository without sharing uncommitted files with another agent.
