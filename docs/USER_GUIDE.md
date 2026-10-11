# Shipping Rate Calculator user guide

Use the calculator to compare Canada Post, Loomis Express and FedEx services for your shipment. Sign in, configure your carrier accounts, enter the shipment and compare the returned rates.

The screenshots and animation below use a fictional account, example addresses and **mock rates**. These prices are samples, not live carrier quotes. Sandbox is for testing; production uses your separately saved production carrier settings.

## Animated rate walkthrough

![Eight steps showing address entry, parcel measurements, optional coverage and rate comparison](images/user-guide/rate-walkthrough.gif)

## Sign in and choose your area

Open the app and sign in with the account provided by your administrator. Production pages use `/login`, `/rate` and `/setting`; sandbox pages use `/sandbox/login`, `/sandbox/rate` and `/sandbox/setting`. If your session expires, sign in again.

![Sandbox sign in](images/user-guide/01-sign-in.png)

## Set up your carriers

Open **Settings** in the area you want to use. Each carrier has its own account settings.

1. Enter the carrier API URL and the credentials issued for that environment. Use your carrier account details, not the calculator login.
2. Select the rate type for Canada Post: counter retail or commercial account, as appropriate for your account.
3. Enable the carrier and click **Save settings** on its card.
4. Click **Test connection** after saving. Review the result and correct any configuration errors before quoting.

Blank secret fields keep previously saved secrets. **Clear settings** edits the form; click **Save settings** to remove the stored settings. Save each changed card before leaving the page. Sandbox credentials and production credentials are separate.

![Three carrier settings cards with empty credentials](images/user-guide/02-carrier-settings.png)

## Enter addresses and save an origin

Open **Rates**. Enter the origin and destination city, province and postal code in their respective sections. Add contact and street details when required for your shipment.

For an origin you use often, expand **Save or manage origin profiles**, enter a **Profile name**, then click **Save as profile**. Select it from **Saved Ship From Profile** on later shipments. **Set default** makes a saved origin load automatically. Destination details remain independent.

![Origin address and profile controls](images/user-guide/03-origin-profile.png)

## Enter the package

Choose **Imperial · lb / in** or **Metric · kg / cm**, then enter weight, length, width and height. Switching units converts the existing measurements. Enter accurate measurements: blank or zero fields use 1 in the selected units when quoting.

Choose the ship date. Select **Signature required** if needed and enter a **Coverage / declared value (CAD)** amount to compare covered and uncovered rates. Declared value does not guarantee insurance coverage; carrier terms apply.

Click **Compare rates** and wait for the carrier responses.

![Shipment addresses and package options](images/user-guide/04-shipment.png)

## Compare and share rates

Review the carrier status cards first. A failed carrier may return no services while other carriers still succeed. Correct settings or shipment details and retry as needed.

Use the sorting control to order the services and **Include tax** to change the displayed tax setting. Compare delivery estimates, prices without and with coverage, and signature availability. Expand **Quote details** for more information. **Show / hide services** controls which services appear.

Click **Copy table** to paste the displayed comparison into a message or document. **Copy API result** copies an individual service's carrier response when available. Changing the shipment clears stale results; click **Compare rates** again.

Quotes are estimates. Final charges and coverage terms may differ. The calculator compares rates; it does not purchase shipping labels. Quote results are not saved.

![Sample comparison with carrier statuses, coverage columns and copying controls](images/user-guide/05-rate-comparison.png)

## Use the calculator on a phone

Use the same steps on mobile. Package fields stack vertically; scroll down to compare the results.

![Mobile shipment and rate comparison](images/user-guide/06-mobile.png)

## Manage accounts as an administrator

Administrators can open `/admin` or `/sandbox/admin` to create accounts, change roles, reset passwords and grant Web or API access independently. Enable Web access for people using the calculator in a browser. Account changes revoke existing sessions, so affected users must sign in again.

![Administrator account controls using a fictional account](images/user-guide/07-admin-accounts.png)
