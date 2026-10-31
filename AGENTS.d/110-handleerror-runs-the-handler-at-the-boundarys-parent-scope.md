## handleError runs the handler at the boundary's parent scope

Set currentOwner to the boundary's owner and clear currentObserver around the handler; run it inside the boundary and a rethrow is caught by that same boundary instead of escaping to the next one up.
