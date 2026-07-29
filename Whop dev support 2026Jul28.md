# Whop dev support 2026Jul28

## practitioner = company paradigm
Create Company >> Provision company to practitioner >> Create Checkout >> links to Wallet

### https://docs.whop.com/api-reference/companies/create-company
Onboarded practitioner = connected account belonging to a created company

## optional transaction platform fee, code snippet 

onst checkoutConfig = await client.checkoutConfigurations.create({
  company_id: "biz_xxxxxxxxxxxxx", // Connected account's company ID
  plan: {
    initial_price: 10.0,
    plan_type: "one_time",
    application_fee_amount: 1.23, // Your platform's fee
  },
});

console.log(checkoutConfig.purchase_url);

## WHOP API support contact
johnny.gonzales@whop.com
