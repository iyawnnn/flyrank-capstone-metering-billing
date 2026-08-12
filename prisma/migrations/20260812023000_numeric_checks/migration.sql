ALTER TABLE "UsageEvent"
  ADD CONSTRAINT "UsageEvent_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "UsageEvent_costMicroCents_nonnegative" CHECK ("costMicroCents" >= 0);

ALTER TABLE "Plan"
  ADD CONSTRAINT "Plan_monthlyApiCallLimit_positive" CHECK ("monthlyApiCallLimit" > 0),
  ADD CONSTRAINT "Plan_monthlyTokenLimit_positive" CHECK ("monthlyTokenLimit" > 0);
