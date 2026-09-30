---
title: Sign In with Microsoft Entra ID
sidebar_label: Entra ID Single Sign-On
description: >-
  Let your users sign in to Scout Console with their Microsoft Entra ID
  accounts by registering an application in your own Entra ID tenant.
keywords:
  - single sign-on
  - sso
  - microsoft entra id
  - azure ad sso
  - entra id app registration
  - scout console
  - identity management
sidebar_position: 2.5
---

## Overview

Connect your Microsoft Entra ID tenant to Scout Console so that your users sign
in with their existing Microsoft work accounts.

You register an application in **your own** Entra ID tenant and send base14
its credentials. base14 then enables Microsoft sign-in for your organization.
Sign-in is limited to users of your tenant.

:::info What single sign-on does and doesn't do

- **Sign-in only.** Single sign-on authenticates users who already have a Scout
  Console account. It does not create accounts.
- **Accounts come first.** Invite users in Scout Console, or provision them
  automatically with
  [Entra ID Provisioning](./provision-users-entra-scim.md).
- **Roles are not synced.** Roles are managed in Scout Console. See
  [User Management](./user-management.md#changing-user-roles).

:::

## Prerequisites

- **The Application Administrator or Cloud Application Administrator role**
  in your Entra ID tenant.
- **Your organization's redirect URI from base14.** Contact base14 Support to
  request it.
- **Matching email addresses.** Each user's email address in Entra ID must
  match the email address on their Scout Console account.

Single sign-on works on every Entra ID tier, including the free tier.

## Step 1: Register the Application

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com).
2. Go to **Identity** → **Applications** → **App registrations**.
3. Select **New registration**.
4. Enter a name, for example `base14 Scout SSO`.
5. Under **Supported account types**, select
   **Accounts in this organizational directory only (Single tenant)**.
6. Under **Redirect URI**, select the **Web** platform and paste the redirect
   URI that base14 provided.
7. Select **Register**.

:::warning Use the Web platform

The redirect URI must be registered under the **Web** platform, not
**Single-page application** or **Public client**. The URI must match the
value base14 provided exactly.

:::

## Step 2: Create a Client Secret

1. In your new application, select **Certificates & secrets**.
2. On the **Client secrets** tab, select **New client secret**.
3. Enter a description and choose an expiry.
4. Select **Add**.
5. Copy the secret's **Value** immediately. Entra ID shows it only once.

:::note

Copy the **Value** column, not the **Secret ID**. The Secret ID is not the
secret.

:::

## Step 3: Confirm API Permissions

1. Select **API permissions**.
2. Confirm that **Microsoft Graph** → **User.Read** (Delegated) is listed. New
   registrations include it by default.
3. If it is missing, select **Add a permission** → **Microsoft Graph** →
   **Delegated permissions**, add `User.Read`, and select **Add permissions**.
4. Select **Grant admin consent for &lt;your tenant&gt;** and confirm.
5. Confirm the **Status** column for `User.Read` shows **Granted for
   &lt;your tenant&gt;**.

:::warning Grant admin consent

Do not skip admin consent. Without it, users either see a consent prompt they
cannot approve, or sign-in fails after they authenticate with Microsoft. See
[Sign-in fails after authenticating with Microsoft](#sign-in-fails-after-authenticating-with-microsoft).

:::

## Step 4: Send the Details to base14

Collect these values:

| Value | Where to find it |
| --- | --- |
| Application (client) ID | **Overview** → **Application (client) ID** |
| Directory (tenant) ID | **Overview** → **Directory (tenant) ID** |
| Client secret | The value you copied in [Step 2](#step-2-create-a-client-secret) |

Send them to base14 Support through a secure channel. Never send the client
secret in plain email. base14 enables single sign-on for your organization and
confirms when it is ready.

## Step 5: Test Sign-In

1. Open Scout Console in a private browser window.
2. On the sign-in page, select **Microsoft**.
3. Sign in with an Entra ID account whose email matches an existing Scout
   Console user.
4. Confirm that you land in Scout Console as that user.

## Rotating the Client Secret

Entra ID client secrets expire. When a secret expires, Microsoft sign-in stops
working for your organization.

Before the expiry date:

1. Create a new client secret as described in
   [Step 2](#step-2-create-a-client-secret).
2. Send the new value to base14 Support.
3. After base14 confirms the update, delete the old secret in Entra ID.

Set a reminder for the expiry date when you create each secret.

## Troubleshooting

### "AADSTS50011: The redirect URI ... does not match"

The redirect URI in your application does not exactly match the one Scout
Console sends. Return to **Authentication** in your application and confirm
the **Web** redirect URI matches the value base14 provided, character for
character.

### "AADSTS7000215: Invalid client secret provided"

The client secret base14 has on file is wrong or has expired. Common causes:

- The **Secret ID** was sent instead of the **Value**.
- The secret was truncated when copied.
- The secret has passed its expiry date.

Create a new secret and send it to base14 Support.

### "AADSTS50020: User account ... does not exist in tenant"

The user is signing in with an account from a different Entra ID tenant.
Sign-in is restricted to your tenant. The user must sign in with their account
in your directory.

### "AADSTS65004: User declined to consent to access the app"

The user cancelled the Microsoft consent prompt, or was shown a prompt that
only an administrator can approve. Grant admin consent as described in
[Step 3](#step-3-confirm-api-permissions) so users are not prompted.

### Sign-in fails after authenticating with Microsoft

Users enter their Microsoft credentials successfully, but are returned to
Scout Console with an error. base14 sees this as Microsoft Graph refusing to
return the user's profile (`Authorization_RequestDenied`).

Admin consent has not been granted for `User.Read`. Return to
[Step 3](#step-3-confirm-api-permissions), select
**Grant admin consent for &lt;your tenant&gt;**, and confirm that the status
shows **Granted**. No change is needed on the base14 side.

### Sign-in succeeds at Microsoft but Scout Console shows an error

No Scout Console account matches the user's email address. Single sign-on
does not create accounts. Invite the user in Scout Console, or provision them
with [Entra ID Provisioning](./provision-users-entra-scim.md). Then confirm that
the email address on their Scout Console account matches their email in Entra
ID.

## Getting Help

If sign-in still fails after working through the steps above,
[contact the base14 team](mailto:support@base14.io) with:

- The full error text, including any `AADSTS` code.
- The email address of an affected user.
- The **Application (client) ID** of your app registration. Do not include the
  client secret.

## Related Guides

- [Entra ID Provisioning](./provision-users-entra-scim.md) - Create and
  disable Scout Console users automatically from Entra ID
- [User Management and Access Control](./user-management.md) - Assign roles
  and manage users in Scout Console
