Write me a function that takes in a json in its input (in the form of a dictionary), and return a data object.
Use wpp+planning.md for additional definition of data structure. Make sure the dataclass adheres to the definition.

Some of my input pipeline would have missing ports information (the entry will be there, but empty). The tiles entry captures the ports information. Write me a function that generates the ports dictionary by parsing through tiles. For detailed definition, see wpp+planning and the image for which port in tiles corresponds to which ports in the actual ports dict

There is also a chance that the data is wrong in the sense that the port information captured by "tiles" and "ports" are different. Write a function to check whether the port informations are valid. Focus on 3 things: 1. does access nodes of the same port have the same port type? 2. does the port count match? (4 general 3:1 and one of each type). 3. does the port info captured by "tiles" and "ports" the same? Look at wpp planning for detailed implementation

Now use the two functions you just built to repair/validate the json input. Your parsing function should: take the input, check if "ports" is empty. If so generate port info. After that, validate the port info. Then return if it is validated. Otherwise throw error

In some source of the json, "players" may be empty. Edit your json to pydemic code such that if "players" is an empty list, initialize 4 players in a "default" way. Analyze WPP+Planning.md to figure out what is appropriate for a default player 


THe board display need some major update to show player stat, roads, settlements. Search the internet for stuff like CLI catan game, ASCII catan board, or anything that helps you. If you find a good implementation that allows visualization of the board, settles, roads, and player info, change the implementation. If not, use your knowledge of catan to implement a way to display all of these extra element. Refer to the sample json to see how road/settle info is stored.






Create me a scoring function that takes in the data object and a settlement spot (see data object definition for the format). It should output the score of that settlement spot

Parameters: make them obvious to adjust by me later.
base resource strength: 5 element array
relative strength dampning: some param decide by what exact dampning 
port bonus: float.
prime variate bonus: float.
evaluation weighting: 4 floats.


Outline of algorithm:
1. Calculate production of each type of resource. this will yield you with the total productivity of each resource in points. (in that 2 is 1 point, 3 is 2 point, ... 6 is 5 point, 8 is 5 point, ... 11 is 2 point, 12 is 1 point)
1.1. Use the relative yield to calculate a relative strength of each resources. The strength is the product of: base resource strength, which is a constant; overall strength, which is 1 / total_productivity_of_resource; pairwise strength, which is its production / its complement's production. Note: wood and brick are complements, wheat and ore are complements, sheep is nobody's complement.
After obtaining the relative strength, apply some variable dampning method so the model won't overvalue a resource like crazy.
2. find out all open settlement spots, calculate spot's production, which should be an array of 5 elements, capturing how much production of each resource will the tile bring. 
2.1. the total production of the tile is the first evaluation metric
2.2. the sum of item-wise product of tile's per resource production and the relative strength of resources is the second evaluation metric

Definition of port strength for 2:1s: normalize each resources' total yield  after dampning such that the second highest is 1. this is the relative strength of the ports. 3:1 has strength 1.

Port bonus is the third metric. If the settlement has a port on it, port bonus is port strength times port bonus (parameter). else 0

prime variate bonus is the 4th metric: if the tile's total production is >= 10, and it has 3 different resources, apply prime variate bonus.

multiply evaluation weighting of each metric to the value of the metric, sum them, that is the total score of the settlement.

Task: implement this algorithm, leaving the parameters easy to be adjusted by me.
Do so in a new file called settle_eval_simple.py




Create me a function called in game_state.py that when called, run the previously defined evaluation algorithm on every single valid settlement spots. NOTE: YOU MUST CAREFULLY CONFIRM THE SET OF VALID SETTLEMENT SPOTS. 


Create me a simple settlement decision algorithm. It should take in a board data object. and output the best settlements and road for the next player (see data object definition as to the format). Your result should be in the form of a 3-tuple of ((settle_spot, road_spot): probability). Note that you cannot place a settlement next to another settlement, your road must be next to the current settlement you placed, and that all catan rules are applied. Another thing to note is that the data structure technically allows placing roads in the ocean, but you MUST NOT do that as it is not a legal placement.

Parameter:
K

To decide: pick the top 3 options, subtract each by (K * third_score). apply softmax on the results to be the probability of each.
Road: point it to: a settlement less than 4 roads away, are not the top 9 scoring, and are the highest scoring amongst settlements that match previous req.

Note, for ((settle_spot, road_spot): probability), road is not a direction, but a 2-tuple like how road is supposed to 


python manual_processing/visualize_board.py src/sample.json --score

---