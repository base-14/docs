---
title: Provision Users from Microsoft Entra ID
sidebar_label: Entra ID Provisioning
description: >-
  Automatically create, update, and disable Scout Console users from your
  Microsoft Entra ID directory using SCIM provisioning.
keywords:
  - scim provisioning
  - microsoft entra id
  - entra id scim
  - azure ad provisioning
  - automatic user provisioning
  - scout console
  - user management
  - identity management
sidebar_position: 2
---

## Overview

Connect your Microsoft Entra ID tenant to Scout Console so that user accounts
are created, updated, and disabled automatically from your directory. Once
this is set up, you no longer invite users to Scout Console by hand.

:::info What is and isn't synced

This integration provisions **users only**.

- **Roles are not provisioned.** Every synced user arrives with the **Viewer**
  role. An Admin assigns their actual role in Scout Console.
- **Groups are not provisioned.** Entra ID groups do not become Scout Console
  roles, teams, or organizations.
- **Sign-in is configured separately.** Provisioning creates and maintains
  accounts. It does not configure single sign-on.

:::

## Prerequisites

:::warning Microsoft Entra ID P1 or P2 is required

Automatic provisioning and application assignment are premium capabilities.
They are unavailable on the free tier of Microsoft Entra ID.

:::

- **The Cloud Application Administrator role** in your Entra ID tenant, or
  ownership of the application you create.
- **Complete user records.** Every user you intend to sync must have a first
  name, last name, and email address populated in Entra ID. Users missing any
  of these are rejected.
- **Your connection details from base14.** Contact base14 support to request
  them. They are listed in [Step 2](#step-2-connect-to-base14).

## Step 1: Create the Application

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com).
2. Go to **Identity** → **Applications** → **Enterprise applications**.
3. Select **New application**.
4. Select **Create your own application**.
5. Enter a name, for example `base14 Scout`.
6. Select **Integrate any other application you don't find in the gallery
   (Non-gallery)**.
7. Select **Create**.

:::warning Create a non-gallery application

Do not start from a gallery listing. Gallery applications that were not built
for this integration report **"Out of the box automatic provisioning is not
supported"** on the application Overview page, and the Provisioning tab will
not accept a configuration. Only the non-gallery path above works.

:::

## Step 2: Connect to base14

1. Open your new application and select **Provisioning** in the left menu.
2. Select **Get started**.
3. Set **Provisioning Mode** to **Automatic**.
4. Expand **Admin Credentials** and set the authentication method to
   **OAuth 2.0 client credentials grant**.
5. Fill in the four fields using the values base14 provided:

   | Field | Value |
   | --- | --- |
   | Tenant URL | `https://id.base14.io/realms/<your-organization>/scim/v2` |
   | Token endpoint | `https://id.base14.io/realms/<your-organization>/protocol/openid-connect/token` |
   | Client ID | `scim-connector` |
   | Client secret | Provided securely by base14 |

6. Select **Test Connection**.
7. Once the test succeeds, select **Save**.

Paste the exact values base14 sent you. The URL shapes are shown only so you
can check your work.

:::note

If **Test Connection** fails, see
[Test Connection fails](#test-connection-fails).

:::

## Step 3: Map User Attributes

Scout Console accepts exactly six attributes, and Entra ID sends many more by
default.

1. Select **Provisioning**, then expand **Mappings**.
2. Select **Provision Microsoft Entra ID Users**.
3. Edit the **Attribute Mappings** list so that exactly these six rows remain:

   | Entra ID source attribute | Scout Console target attribute | Matching |
   | --- | --- | --- |
   | `userPrincipalName` | `userName` | Yes, precedence 1 |
   | `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | No |
   | `givenName` | `name.givenName` | No |
   | `surname` | `name.familyName` | No |
   | `mail` | `emails[type eq "work"].value` | No |
   | `objectId` | `externalId` | No |

4. Delete every other row. Select the row, then select **Delete** at the
   bottom of the panel.
5. Confirm that `userName` is the only attribute used for matching, with
   **Match objects using this attribute** set to **Yes** and
   **Matching precedence** set to `1`.
6. Select **Save**.

:::warning Delete every other default row

Remove all rows that are not in the table above — in particular
`addresses[...]`, `phoneNumbers[...]`, `title`, `preferredLanguage`,
`displayName`, and any rows from the enterprise user extension.

Scout Console accepts only the six attributes listed. Sending any other
attribute causes provisioning to fail for every user in the cycle.

:::

:::note Setting the active mapping

The `active` row uses an expression rather than a direct attribute. When you
add it, set **Mapping type** to **Expression** and paste the `Switch(...)`
value into the **Expression** field. This is what disables a user in Scout
Console when they are soft-deleted in Entra ID.

:::

## Step 4: Choose Who Gets Synced

1. Select **Provisioning** → **Settings**.
2. Set **Scope** to **Sync only assigned users and groups**.
3. Select **Save**.
4. Go to your application → **Users and groups** → **Add user/group**.
5. Assign the users you want synced to Scout Console.

Assign individual users rather than groups. Group objects are not provisioned
into Scout Console.

## Step 5: Test, Then Start Provisioning

Validate with a single user before enabling the ongoing sync.

1. Select **Provisioning** → **Provision on demand**.
2. Select one assigned user and select **Provision**.
3. Confirm that every step reports success.
4. In Scout Console, go to **Users** and confirm the user appears.
5. Return to the Provisioning overview and select **Start provisioning**.

:::note Users who already have a Scout Console account

Because matching is done on `userName`, a user who was invited to Scout
Console manually before you set this up is updated in place rather than
duplicated, as long as their Entra ID user principal name matches the email
address on their existing account.

:::

:::note Sync timing

After you start provisioning, Entra ID runs a sync cycle roughly every 40
minutes. The initial cycle can take longer because it enumerates every
assigned user. A newly assigned user will not appear in Scout Console
instantly — use **Provision on demand** if you need them immediately.

:::

## Assign Roles in Scout Console

Provisioned users arrive with the **Viewer** role, which is read-only. An
Admin grants them their actual level of access in Scout Console.

1. In Scout Console, go to **Users**.
2. Find the provisioned user.
3. Change their role to Admin, Editor, or Viewer as appropriate.

Roles are managed entirely in Scout Console and are never overwritten by a
sync. Changing a user's role does not affect their provisioning status. See
[Changing User Roles](./user-management.md#changing-user-roles) for details.

## Deprovisioning Users

Users are set to **Disabled** in Scout Console automatically when they leave
your directory or lose access to the application:

- **Unassign the user** from the application in **Users and groups**.
- **Disable or delete the user** in Entra ID.

Either action disables the user in Scout Console on the next sync cycle.
Disabled users cannot sign in. Their history and any dashboards they created
are retained.

To restore someone, reassign them to the application. They are re-enabled on
the next cycle.

## Troubleshooting

### "Unrecognized attribute" errors

An unsupported row is still present in your attribute mapping. The error names
the attribute, for example `addresses` or `phoneNumbers`.

Return to [Step 3](#step-3-map-user-attributes), delete every row that is not
one of the six listed, and save.

### "Please specify lastName" or "Please specify email"

The user is missing a required field in Entra ID. Populate their surname or
email address in the directory, and confirm that `surname` and `mail` are
mapped as shown in [Step 3](#step-3-map-user-attributes).

### Test Connection fails

Re-check the Tenant URL, token endpoint, and client secret against the values
base14 sent you. Client secrets are frequently truncated when copied — paste
the full value rather than retyping it.

### "Out of the box automatic provisioning is not supported"

This notice on the application Overview page means you started from a gallery
listing. Delete the application and create a non-gallery application as
described in [Step 1](#step-1-create-the-application).

### A user was assigned but has not appeared

Sync cycles run roughly every 40 minutes. Confirm the user is assigned under
**Users and groups**, then use **Provision on demand** to process them
immediately and see any per-user error.

## Getting Help

If provisioning still fails after working through the steps above, contact
base14 support with:

- The error text from **Provisioning logs** in the Entra admin center.
- The user principal name of an affected user.
- A screenshot of your attribute mapping list.

## Related Guides

- [User Management and Access Control](./user-management.md) - Assign roles
  and manage users in Scout Console
