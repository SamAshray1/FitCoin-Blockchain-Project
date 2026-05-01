// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IYoda {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract Marketplace {

    /* ========== TOKEN ========== */
    IYoda public token;

    constructor(address _token) {
        require(_token != address(0), "Invalid token address");
        token = IYoda(_token);
    }

    /* ========== PRODUCT MARKETPLACE ========== */

    struct Product {
        uint256 id;
        string name;
        uint256 price;
        address seller;
        bool exists;
    }

    uint256 public productCount;
    mapping(uint256 => Product) public products;

    event ProductAdded(uint256 id, string name, uint256 price, address seller);
    event ProductPurchased(uint256 id, address buyer);

    function addProduct(string memory _name, uint256 _price) public {
        require(bytes(_name).length > 0, "Invalid name");
        require(_price > 0, "Price must be > 0");

        productCount++;

        products[productCount] = Product({
            id: productCount,
            name: _name,
            price: _price,
            seller: msg.sender,
            exists: true
        });

        emit ProductAdded(productCount, _name, _price, msg.sender);
    }

    function buyProduct(uint256 _id) public {
        Product storage p = products[_id];

        require(p.exists, "Product does not exist");
        require(msg.sender != p.seller, "Seller cannot buy own product");

        bool success = token.transferFrom(msg.sender, p.seller, p.price);
        require(success, "YODA transfer failed");

        emit ProductPurchased(_id, msg.sender);
    }

    /* ========== FITNESS PLAN SYSTEM ========== */

    struct Plan {
        uint8 durationDays;
        uint256 pricePaid;
        uint256 rewardPerDay;
        uint256 startTimestamp;
        uint256 daysLogged;
        uint256 totalWithdrawn;
        bool active;
        uint256 lastWorkoutTime;
    }

    mapping(address => Plan) public plans;

    uint256 public constant PLAN_21_PRICE = 2000; // 20.00 YODA
    uint256 public constant PLAN_42_PRICE = 4000; // 40.00 YODA
    uint256 public constant PLAN_63_PRICE = 6000; // 60.00 YODA

    event PlanPurchased(address user, uint8 duration);
    event WorkoutLogged(address user, uint256 totalDays);
    event RewardWithdrawn(address user, uint256 amount);

    function buyPlan(uint8 durationDays) public {
        uint256 price;

        if (durationDays == 21) price = PLAN_21_PRICE;
        else if (durationDays == 42) price = PLAN_42_PRICE;
        else if (durationDays == 63) price = PLAN_63_PRICE;
        else revert("Invalid duration");

        require(!plans[msg.sender].active, "Already active");

        require(token.transferFrom(msg.sender, address(this), price), "Payment failed");

        plans[msg.sender] = Plan({
            durationDays: durationDays,
            pricePaid: price,
            rewardPerDay: price / durationDays,
            startTimestamp: block.timestamp,
            daysLogged: 0,
            totalWithdrawn: 0,
            active: true,
            lastWorkoutTime: 0
        });

        emit PlanPurchased(msg.sender, durationDays);
    }

    function logWorkout() public {
        Plan storage p = plans[msg.sender];

        require(p.active, "No active plan");
        require(p.daysLogged < p.durationDays, "Plan completed");

        // 1 workout per 24h
        require(
            block.timestamp >= p.lastWorkoutTime + 1 days,
            "Already logged today"
        );

        p.daysLogged++;
        p.lastWorkoutTime = block.timestamp;

        emit WorkoutLogged(msg.sender, p.daysLogged);
    }

    function withdrawRewards() public {
        Plan storage p = plans[msg.sender];

        require(p.active, "No plan");

        uint256 totalEarned = p.daysLogged * p.rewardPerDay;
        uint256 pending = totalEarned - p.totalWithdrawn;

        require(pending > 0, "No rewards");

        p.totalWithdrawn += pending;

        require(token.transfer(msg.sender, pending), "Transfer failed");

        emit RewardWithdrawn(msg.sender, pending);

        // deactivate when complete
        if (p.daysLogged == p.durationDays) {
            p.active = false;
        }
    }

    function getPlanInfo(address user) public view returns (
        uint8 durationDays,
        uint256 pricePaid,
        uint256 rewardPerDay,
        uint256 startTimestamp,
        uint256 daysLogged,
        uint256 totalWithdrawn,
        bool active,
        bool loggedToday
    ) {
        Plan memory p = plans[user];

        bool logged = false;
        if (p.lastWorkoutTime != 0) {
            logged = block.timestamp < p.lastWorkoutTime + 1 days;
        }

        return (
            p.durationDays,
            p.pricePaid,
            p.rewardPerDay,
            p.startTimestamp,
            p.daysLogged,
            p.totalWithdrawn,
            p.active,
            logged
        );
    }
}