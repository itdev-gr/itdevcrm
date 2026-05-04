-- Backfill legacy free-text industry values to the new dropdown codes so
-- the form stops showing "(legacy)" pills. Anything we can't map cleanly
-- falls through to 'other'.
--
-- The mapping is intentionally conservative — only obvious matches.
-- Edit-and-resave still works for ambiguous cases.

create or replace function public._industry_to_code(raw text)
returns text
language sql immutable as $$
  select case lower(trim(raw))
    when 'technology' then 'technology'
    when 'tech' then 'technology'
    when 'it' then 'technology'
    when 'ecommerce' then 'ecommerce'
    when 'e-commerce' then 'ecommerce'
    when 'retail' then 'retail'
    when 'real estate' then 'real_estate'
    when 'healthcare' then 'healthcare'
    when 'health' then 'healthcare'
    when 'medical' then 'healthcare'
    when 'education' then 'education'
    when 'hospitality' then 'hospitality'
    when 'hotels' then 'hospitality'
    when 'food & beverage' then 'food_beverage'
    when 'food and beverage' then 'food_beverage'
    when 'beverages' then 'food_beverage'
    when 'food' then 'food_beverage'
    when 'restaurants' then 'food_beverage'
    when 'tourism' then 'tourism'
    when 'travel' then 'tourism'
    when 'construction' then 'construction'
    when 'automotive' then 'automotive'
    when 'beauty & wellness' then 'beauty_wellness'
    when 'beauty' then 'beauty_wellness'
    when 'wellness' then 'beauty_wellness'
    when 'fitness & sports' then 'fitness_sports'
    when 'fitness' then 'fitness_sports'
    when 'sports' then 'fitness_sports'
    when 'gym' then 'fitness_sports'
    when 'finance' then 'finance'
    when 'finance & insurance' then 'finance'
    when 'insurance' then 'finance'
    when 'banking' then 'finance'
    when 'legal' then 'legal'
    when 'legal services' then 'legal'
    when 'law' then 'legal'
    when 'manufacturing' then 'manufacturing'
    when 'marketing' then 'marketing'
    when 'marketing & advertising' then 'marketing'
    when 'advertising' then 'marketing'
    when 'maritime' then 'maritime'
    when 'maritime & shipping' then 'maritime'
    when 'shipping' then 'maritime'
    when 'logistics' then 'logistics'
    when 'logistics & transport' then 'logistics'
    when 'transport' then 'logistics'
    when 'transportation' then 'logistics'
    when 'agriculture' then 'other'
    when 'jewelers' then 'other'
    else null
  end;
$$;

update public.leads
   set industry = public._industry_to_code(industry)
 where industry is not null
   and public._industry_to_code(industry) is not null;

update public.clients
   set industry = public._industry_to_code(industry)
 where industry is not null
   and public._industry_to_code(industry) is not null;

drop function public._industry_to_code(text);
