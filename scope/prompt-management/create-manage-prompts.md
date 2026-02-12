---
title: Create & Manage Prompts
sidebar_position: 1
description: How to create, edit, organize, and delete prompts in Scope.
keywords: [scope prompts, create prompt, manage prompts, prompt tags]
---

# Create & Manage Prompts

Prompts are the central resource in Scope. This guide covers the full lifecycle
— creating prompts, editing metadata, organizing with tags, and deleting prompts
you no longer need.

## Create a Prompt

1. Click **New Prompt** from the prompt list
2. Enter a unique **name** (e.g., `customer-support-reply`)
3. Write your prompt content in the editor — use `{{variable}}` syntax for
  dynamic values
4. Optionally add a **description** and **tags**
5. Click **Create**

Scope creates the prompt with an initial version (`v1`) in **draft** status.
Variables like `{{customer_name}}` are automatically detected from the content.

:::tip
Choose descriptive, hyphenated names for prompts (e.g., `order-summary`,
`code-review`). The name is used to fetch the prompt via SDK and API, so it
should be stable and meaningful.
:::

## View and Browse Prompts

The prompt list shows all prompts in your workspace. You can:

- **Search** by name or description using the search bar
- **Filter by tags** to narrow results
- **Filter by status** — show only prompts with a production version or drafts
  only
- **Sort** by name, creation date, or last updated

Each prompt card displays the name, description, latest version number,
production version (if any), and tags.

## Edit Prompt Metadata

To update a prompt's name, description, or tags:

1. Open the prompt from the list
2. Click the prompt name or metadata area to edit
3. Update the fields:
   - **Name** — must remain unique across your workspace
   - **Description** — optional summary of the prompt's purpose
   - **Tags** — add or remove tags for organization
4. Save your changes

:::info
Editing metadata does not create a new version. To change the prompt content,
create a new version instead.
:::

## Organize with Tags

Tags help you categorize and filter prompts. Common tagging strategies:

| Strategy | Examples |
|----------|----------|
| By team | `engineering`, `marketing`, `support` |
| By use case | `chat`, `summarization`, `extraction` |
| By status | `experimental`, `stable`, `deprecated` |
| By product | `billing`, `onboarding`, `notifications` |

You can filter the prompt list by one or more tags. Prompts must match **all**
specified tags (AND logic).

## Delete a Prompt

:::warning
Deleting a prompt removes it and all its versions. This action cannot be undone.
Make sure no applications are actively fetching this prompt before deleting it.
:::

To delete a prompt:

1. Open the prompt
2. Access the prompt's settings or actions menu
3. Click **Delete**
4. Confirm the deletion

## Next Steps

- [Working with Versions](./working-with-versions.md)
  — create and manage prompt versions
- [Using Prompt Variables](./using-prompt-variables.md) — template syntax and rendering
- [Testing Prompts](./testing-prompts.md) — test prompts before promoting
