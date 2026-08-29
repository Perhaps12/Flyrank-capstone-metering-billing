## PHASE 1  
### 2026-08-24  
Designed general file structure and database schema; identified required technologies  
Claude assisted with refining overall project structure and created a well formatted design doc  
  
Etablished basic backend code and setup the docker + container

### 2026-08-25
Created the relevant database functions including queries, connections to docker, and seeded values

### 2026-08-26
Began testing upon database queries  
Claude recommended the jest library for this; verified & used a testing script created by claude  
Wrote down download instructions in ReadMe + included design intentions about middleware  

## PHASE 2  
### 2026-08-26  
Added core logic to calculate and compare call/token usages along with computing costs  
Used AI + jest to create a seperate domain/ test file  
  
Idempotency on call/token usage implemented on 2 levels:
- ```sql UNIQUE (tenant_id, idempotency_key)``` on the usageEvents table rejects any addition which matches both those categories
- ```domain/metering.ts``` moniters whenever a usage event tries to be inserted and manages the case where 2 of the same request are sent at the same time  
  
Subscription idempotency to be added via webhooks

Implemented the POST /generate route  

### 2026-08-27
Additional testing implemented and passed
Populated EVIDENCE.md with real examples

## PHASE 3
### 2026-08-27
Configured stripe account and downloaded necessary packages
Established the billing routes, webhook connections and stripe services

### 2026-08-28
Metering tests & billing created and passed

## PHASE 4
### 2026-08-29
Working on finalising EVIDENCE + README
Fixed some bugs involving pricing