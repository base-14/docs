---
title: Scout Console RBAC - User Management and Access Control
sidebar_label: Console RBAC
description: >-
  Complete guide to Scout Console role-based access control (RBAC), user
  management, organization settings, and account configuration.
keywords:
  - scout rbac
  - user management
  - role-based access control
  - scout console
  - organization settings
  - account settings
  - admin roles
  - editor roles
  - viewer roles
sidebar_position: 1
---

## Getting Started

### Accessing Scout Console

1. **Navigate to your organization's console URL:**

   ```plain showLineNumbers
   https://console.base14.io/your-organization
   ```

2. **Log in with your credentials:**
   - Enter your email address
   - Enter your password
   - Click **Sign In**

3. **After successful login**, you'll be redirected to the Console home page

### Navigation

The Scout Console has a sidebar with the following sections:

- **Users** - Manage team members and their access (Admin only)
- **Organization** - Configure organization details (Admin only)
- **Settings** - Manage your personal account settings

## Understanding Role-Based Access Control (RBAC)

Scout Console uses **Role-Based Access Control (RBAC)** to manage user
permissions. RBAC ensures that users only have access to the features and data
they need to perform their job functions.

### What is RBAC?

RBAC is a security model where access permissions are assigned based on
**roles** rather than individual users. When you assign a role to a user, they
automatically receive all the permissions associated with that role.

### How RBAC Works in Scout Console

1. **Roles are assigned to users**
   - Each user in your organization has one role (Admin, Editor, or Viewer)

2. **Roles determine permissions**
   - The role defines what actions the user can perform

3. **Permissions are enforced**
   - The system automatically allows or denies actions based on the user's role

4. **Roles can be changed**
   - Admins can update user roles as responsibilities change

### Scout Roles and Integration

Scout Console roles are integrated with your monitoring dashboards:

| Scout Console Role | Console Permissions | Dashboard Access |
|-------------------|---------------------|-------------------------|
| **Admin** | Full administrative access | Dashboard Editor |
| **Editor** | View-only access to users and settings | Dashboard Editor |
| **Viewer** | Minimal read-only access | Dashboard Viewer |

> **Important**: When you assign a role in Scout Console, it automatically
> determines the user's access level in dashboards.

## User Management

**Available to:** Admin role only

**RBAC Note:** Only users with the **Admin** role can manage other users. This
permission is automatically granted to all Admins through the RBAC system.

### Viewing Users

1. Click **Users** in the sidebar
2. You'll see a table showing all users in your organization with:
   - Name and email address
   - **Role** (Admin, Editor, or Viewer)
   - Status (Active, Pending, Invited, Disabled)
   - Last active date

### Inviting New Users

1. Click **Users** in the sidebar
2. Click the **Invite User** button (top right)
3. Fill in the invitation form:
   - **Email Address**: User's work email
   - **First Name**: User's first name
   - **Last Name**: User's last name
   - **Role**: Select from Admin, Editor, or Viewer
4. Click **Send Invitation**
5. The user will receive an email with instructions to set up their account

> **Note**: The role you select determines what the user can do in Scout
> Console, their access level in dashboards and alerts (Editor or Viewer), and
> which features they can access immediately upon login. The email domain must
> be in your organization's domain whitelist (see Organization Settings).

### Changing User Roles

Changing a user's role updates their permissions across all Scout services
through RBAC.

1. Navigate to **Users**
2. Find the user you want to modify
3. Click the **⋮** (three dots) menu on their row
4. Select **Change Role**
5. Select the new role from the dropdown:
   - **Admin** - Full administrative access + Dashboard & Alert Editor
   - **Editor** - View-only console access + Dashboard & Alert Editor
   - **Viewer** - Limited read-only access + Dashboard & Alert Viewer
6. Click **Update Role**
7. Changes take effect immediately

> **Important**: Role changes take effect immediately:
>
> - Changes apply to all active sessions
> - Dashboard & Alert permissions update automatically
> - User may see different menu options upon page refresh
> - Downgrading from Admin removes administrative access immediately

### Managing User Status

1. Navigate to **Users**
2. Find the user you want to manage
3. Click the **⋮** (three dots) menu on their row
4. Select the appropriate action:

   **Disable User:**
   - Revoke all access to Scout Console and Dashboard & Alert
   - User cannot log in but account data is preserved
   - RBAC permissions are suspended but role assignment remains
   - Can be re-activated later by changing status to Active

   **Enable User:**
   - Restores access for a disabled user
   - RBAC permissions are reinstated based on assigned role
   - User can log in immediately with existing credentials
   - Dashboard & Alert access is automatically restored

   **Resend Invitation:**
   - Available only for users in "Invited" status
   - Sends a new invitation email to the user
   - Previous invitation link becomes invalid
   - Use this if the original invitation expired or was lost

   **Reset Password:**
   - Triggers a password reset email to the user
   - Does not change the user's role or permissions
   - User must create a new password before their next login
   - RBAC permissions remain unchanged

### Searching Users

1. Navigate to **Users**
2. Use the search box at the top of the user list
3. Type to filter users by:
   - Name
   - Email address
4. Results update automatically as you type
5. Clear the search box to show all users again

> **Tip**: Use search to quickly find users when auditing role assignments or
> reviewing access levels.

## Organization Settings

**Available to:** Admin role only

**RBAC Note:** Only users with the **Admin** role can modify organization
  settings. Editors can view these settings but cannot make changes.

### Viewing Organization Details

1. Click **Organization** in the sidebar
2. You'll see your organization information including:
   - Organization name
   - Industry
   - Website
   - Contact information (email, phone)
   - Billing address
   - Registered address
   - Domain whitelist settings

### Domain Whitelist Configuration

The domain whitelist controls which email domains can be invited to your
organization. This works with RBAC to ensure only authorized users can be
granted roles.

#### Understanding Domain Whitelist

- **Enabled**: Only users with email addresses from approved domains can be
  invited and assigned roles
- **Disabled**: Any email address can be invited (not recommended for
  production)

#### Configuring the Whitelist

1. Navigate to **Organization**
2. Scroll to the **Domain Whitelist** section
3. Following these steps:

   - Select "Only allow specific domains"
   - Click **Add Domain**
   - Enter domain name without @ symbol (e.g., "yourcompany.com")
   - Click **Add**
   - Repeat for additional domains
   - Click **Save Whitelist**

   > **Recommended**: Restricts role assignments to verified company domains

**RBAC Integration:** Domain whitelist acts as the first security layer before
  RBAC roles can be assigned. Users from non-whitelisted domains cannot be
  invited, preventing unauthorized role assignments.

#### Managing Domains

**Adding a Domain:**

1. In the Domain Whitelist section, click **Add Domain**
2. Enter the domain (e.g., "example.com")
3. Click **Add**
4. Click **Save Whitelist** to confirm

**Removing a Domain:**

1. Find the domain in the list
2. Click the **Remove** (×) button next to it
3. Click **Save Whitelist** to confirm

> **Warning**: Users with email addresses from this domain can no longer be
> invited or assigned roles

**Examples of Valid Domains:**

- yourcompany.com
- subsidiary.yourcompany.com
- example.org

## Account Settings

**Available to:** All users (all RBAC roles)

### Viewing Your Profile

1. Click **Settings** in the sidebar
2. You'll see your personal information:
   - Full name
   - Email address
   - **Current role** in the organization (determined by RBAC)
   - Account status
   - Last login date

### Updating Your Profile

1. Navigate to **Settings**
2. Click **Edit Profile**
3. Update your information:
   - **First Name**: Your first/given name
   - **Last Name**: Your last/family name
4. Click **Save Changes**

> **Note**:
>
> - Changing your email address may require verification
> - Your role and RBAC permissions remain unchanged when updating profile
>   information
> - Email domain must match the organization's domain whitelist

### Logging Out

1. Click **Logout** on the left sidebar
2. You'll be redirected to the login page
3. Your session will be terminated securely across all Scout services

## User Roles & Permissions

Scout Console implements three RBAC roles, each with specific permissions:

### Admin Role

**Full administrative access** through RBAC with permissions to manage all
  aspects of the organization.

**Best for:** Team leads, IT administrators, department managers who need full
control

### Editor Role

**View-only console access** with full dashboard editing capabilities.

**Best for:** Team members who need to create and manage monitoring dashboards
but don't require user management access

### Viewer Role

**Best for:** Stakeholders, executives, contractors, or users who only need to
view monitoring data without making changes

### RBAC Permission Matrix

| Feature | Admin | Editor | Viewer |
|---------|:-----:|:------:|:------:|
| **Scout Console** | | | |
| View Users | ✅ | ✅ | ✅ |
| Invite Users | ✅ | ❌ | ❌ |
| Change User Roles | ✅ | ❌ | ❌ |
| Disable/Enable Users | ✅ | ❌ | ❌ |
| Reset User Passwords | ✅ | ❌ | ❌ |
| View Organization Settings | ✅ | ✅ | ❌ |
| Edit Organization Settings | ✅ | ❌ | ❌ |
| Manage Domain Whitelist | ✅ | ❌ | ❌ |
| Edit Own Profile | ✅ | ✅ | ✅ |
| **Dashboards & Alerts** | | | |
| View Dashboards | ✅ | ✅ | ✅ |
| View Alerts | ✅ | ✅ | ✅ |
| Create Dashboards | ✅ | ✅ | ❌ |
| Create Alerts | ✅ | ✅ | ❌ |
| Edit Dashboards | ✅ | ✅ | ❌ |
| Edit Alerts | ✅ | ✅ | ❌ |
| Delete Dashboards | ✅ | ✅ | ❌ |
| Delete Alerts | ✅ | ✅ | ❌ |
| Share Dashboards | ✅ | ✅ | ❌ |
| Dashboard Settings | ✅ | ✅ | ❌ |

## RBAC Best Practices

### Assigning Roles

> **Follow the Principle of Least Privilege**:
>
> - Assign the minimum role necessary for the user's job function
> - Start with Viewer role and elevate only when justified
> - Regularly review role assignments to ensure they're still appropriate

### Security Best Practices

1. **Regular Role Audits:**
   - Review all user roles quarterly
   - Verify each user still requires their current role
   - Downgrade roles when responsibilities change
   - Document reasons for Admin role assignments

2. **Domain Whitelist:**
   - Always enable for production environments
   - Only add verified company domains
   - Review whitelist when company domains change
   - Prevent unauthorized role assignments

3. **User Lifecycle Management:**
   - Assign appropriate role during onboarding
   - Review role after probation period
   - Update role when responsibilities change
   - Disable account immediately upon departure

4. **Password Security:**
   - Reset passwords every 180 days
   - Never share passwords
   - Use strong, unique passwords
   - Use password manager for secure storage

### Operational Best Practices

1. **Role Changes:**
   - Document why role changes are made
   - Notify users before changing their roles
   - Test access after role changes
   - Review impact on dashboard access
   - Review impact on alert access

2. **New User Onboarding:**
   - Start with Viewer or Editor role
   - Provide role-appropriate training
   - Share this user manual
   - Review access needs after first week

3. **Maintaining Multiple Admins:**
   - Have at least 2 Admin users per organization
   - Document who the Admins are
   - Ensure continuity if an Admin leaves
   - Avoid single point of failure

4. **Monitoring RBAC Usage:**
   - Track who has Admin access
   - Review user login activity
   - Audit role change history
   - Monitor for unusual access patterns

## Common Tasks - Quick Guide

### How to: Invite a New User with Appropriate Role

1. Go to **Users** → Click **Invite User**
2. Enter: First Name, Last Name, Email
3. **Select Role carefully:**
   - Admin: Only if they need user management access
   - Editor: If they need dashboard editing (most common)
   - Viewer: If they only need to view dashboards
4. Click **Send Invitation**
5. User receives email with setup instructions
6. Their RBAC permissions activate upon first login

### How to: Change Someone's Role

1. Go to **Users** → Find the user
2. Click **⋮** menu → Select **Change Role**
3. Choose new role (consider dashboard and alert impact)
4. Click **Update Role**
5. Changes apply immediately to console, dashboards, and alerts

### How to: Audit User Roles

1. Go to **Users**
2. Review the **Role** column
3. Verify each user has appropriate access level
4. Look for:
   - Too many Admins (security risk)
   - Users who may need role upgrades
   - Former team members still active
5. Make adjustments as needed

### How to: Disable a User Account

1. Go to **Users** → Find the user
2. Click **⋮** menu → Select **Change Status**
3. Select **Disabled** → Click **Update Status**
4. User loses access to console, dashboards, and alerts immediately
5. RBAC role is preserved for potential re-activation

### How to: Add a Domain to Whitelist

1. Go to **Organization** (Admin role required)
2. Find **Domain Whitelist**
3. Select "Only allow specific domains"
4. Click **Add Domain** → Enter domain → Click **Add**
5. Click **Save Whitelist**

## Troubleshooting

### RBAC-Related Issues

#### Problem: User cannot access Users menu

**Solution:**

1. Reach out to base14 support at [support@base14.io](mailto:support@base14.io)
   on the assignment of **Admin** Role

#### Problem: User says they cannot edit dashboards

**Solution:**

1. Check user's role in Scout Console Users list
2. **Viewer** role = Dashboard Viewer (read-only)
3. Change role to **Editor** or **Admin** for edit access
4. **User must log out and back in** for permissions to update

#### Problem: Cannot change a user's role - option is grayed out

**Solution:**

1. Verify you have **Admin** role (only Admins can manage roles)
2. Check if you're trying to change your own role (not allowed - ask another
   Admin)
3. Refresh the page and try again
4. Verify user's status is "Active" (cannot change roles for disabled users)

#### Problem: User has Admin role but cannot manage users

**Solution:**

1. Have user log out and back in (permissions may not have refreshed)
2. Check user status is "Active" not "Pending" or "Disabled"
3. Verify RBAC permissions by checking what menus are visible
4. Contact support if issue persists after logout/login

### Other Common Issues

#### Problem: Cannot invite a user - "Email domain not allowed"

**Solution:**

1. Go to **Organization** → **Domain Whitelist**
2. Check if the user's email domain is in the list
3. Add the domain if it's a legitimate company domain
4. Try inviting the user again

#### Problem: User says they didn't receive invitation email

**Solution:**

1. Ask user to check spam/junk folder
2. Verify email address is correct in the Users list
3. Go to **Users** → Find the user → **⋮** → **Resend Invitation**
4. If still not received, check domain whitelist settings

#### Problem: Forgot my password

**Solution:**

1. Contact your Administrator, they would be able to 'Reset Password' on your
   behalf.

## Getting Help

### Support Resources

**For Technical Issues:**

- Email: [support@base14.io](mailto:support@base14.io)
- Include: Your organization name, screenshot of issue, steps to reproduce

**For Account, RBAC, or Access Questions:**

- Email: [support@base14.io](mailto:support@base14.io)
- Include: Organization name, affected user's email, current and desired roles

**Documentation:**

- User Manual: (this document)
- API Documentation: [docs.base14.io](https://docs.base14.io)

### What to Include When Reporting an Issue

1. **Organization name** and your **email address**
2. Your **current role** (Admin, Editor, or Viewer)
3. **Description** of the problem
4. **Steps to reproduce** the issue
5. **Screenshots** if applicable
6. **Browser** and **version** you're using
7. **When** the issue started occurring
8. If RBAC-related: affected user's role and what they're trying to access

## Related Guides

- [Creating Alerts](../guides/creating-alerts-with-logx.md) - Configure
  monitoring alerts
- [Create Dashboards](../guides/create-your-first-dashboard.md) - Build custom
  dashboards
- [GitOps for Dashboards and Alerts](./dashboards-and-alerts.md) - Use Grizzly to
  manage dashboards and alerts

## Appendix: Quick Reference

### Role Mapping Reference

| Scout Console Role | Console Access | Role | Access |
|-------------------|---------------|--------------|----------------|
| Admin | Full administrative | Dashboard Editor | Create & Edit |
| Editor | View-only | Dashboard Editor | Create & Edit |
| Viewer | Limited read-only | Dashboard Viewer | View only |

### Glossary

**RBAC (Role-Based Access Control)** - Security model where permissions are
assigned based on roles

**Admin** - RBAC role with full administrative access to Scout Console and
Dashboard & Alert Editor access

**Domain Whitelist** - Security feature that restricts which email domains can
be invited and assigned RBAC roles

**Editor** - RBAC role with view-only console access and Dashboard & Alert
Editor access

**Organization** - Your company or team's account in Scout Console

**Principle of Least Privilege** - Security practice of granting minimum
permissions necessary

**Role** - Set of permissions assigned to a user through RBAC (Admin, Editor,
or Viewer)

**Status** - Current state of a user account (Active, Pending, Invited,
Disabled)

**Viewer** - RBAC role with minimal read-only access to both console and
dashboards
