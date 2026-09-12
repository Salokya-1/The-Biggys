-- A request can be withdrawn by whoever raised it, while it is still undecided.
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
