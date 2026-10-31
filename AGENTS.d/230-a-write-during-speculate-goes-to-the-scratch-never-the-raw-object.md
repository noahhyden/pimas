## A write during speculate goes to the scratch, never the raw object

setProperty and every read path (get trap, readField) must honor speculationScratch(); a branch that touches the raw object while speculating commits the what-if and breaks rollback.
