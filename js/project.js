PERT.Project = class Project
{
    /**
     * @param {String} name
     * @param {DataStore} config
     */
    constructor(name, config)
    {
        this.name = name;
        this.config = config;

        // Default configuration for new projects
        if (!this.config.keys().length) {
            Object.assign(this.configData, {
                resources: {},
                nodes: {},
                edges: {},
                stats: {
                    accessedAt: null,
                    modifiedAt: null,
                    createdAt: Date.now()
                },
                start: '',
                end: ''
            });
        }

        // Setup project UI
        PERT.ui('area').innerHTML = '<div class="project-area"></div>';
        PERT.ui('menu-contents').classList.add('menu-contents-project-loaded');

        const configData = this.configData;
        const projectMenu = PERT.ui('menu-contents-project');

        const template = PERT.ui('templates').import.querySelector('#ProjectTemplate').content;
        const project = document.importNode(template, true).firstElementChild;

        projectMenu.innerHTML = '';
        projectMenu.appendChild(project);

        const dates = project.querySelectorAll('.project-dates input');
        dates[0].value = configData.start;
        dates[1].value = configData.end;

        if (this.isStarted) {
            project.classList.add('project-started');
        }

        // Date change handlers
        dates.forEach((node, index) => {
            const name = index ? 'end' : 'start';
            node.addEventListener('change', e => {
                configData[name] = e.target.value;
                this.recalculateDateConstraints();
            });
        });

        // Generate project resources
        for (const id in configData.resources) {
            this.createResourceInputs(id);
        }
        this.createResourceInputs();

        // Update the last accessed project timestamp
        this.configData.stats.accessedAt = Date.now();
        this.save();

        // Register UI button handlers
        project.querySelector('.project-save').addEventListener('click', () => this.save());
        project.querySelector('.project-export').addEventListener('click', () => this.export());
        project.querySelector('.project-rename').addEventListener('click', () => this.rename());
        project.querySelector('.project-delete').addEventListener('click', () => this.delete());
        project.querySelector('.project-start').addEventListener('click', () => this.start());
        project.querySelector('.project-add-node').addEventListener('click', () => this.addNode());

        // Register pre-HTML5 drag and drop and stats hover handlers
        const projectArea = PERT.ui('area').querySelector('.project-area');

        projectArea.addEventListener('mousemove', e => {
            if (this.moveNode) {
                this.moveNode.drag(e.clientX + projectArea.scrollLeft, e.clientY + projectArea.scrollTop);
            } else {
                let nodeId = null;

                // Recursively determine if the mouse is over a node
                let element = e.srcElement;
                do {
                    if (element.classList.contains('node')) {
                        nodeId = element.id;
                        break;
                    }
                    element = element.parentElement;
                } while (element);

                // Redraw the stats only if their target is different
                if (nodeId !== PERT.currentStats) {
                    PERT.currentStats = nodeId;
                    this.redrawStats(nodeId);
                }
            }
        });

        projectArea.addEventListener('mouseout', e => {
            if (e.fromElement.tagName === 'HTML') {
                this.moveNode = null;
            }
        });

        projectArea.addEventListener('mouseup', () => this.moveNode = null);

        // Edge drag
        projectArea.addEventListener('drag', e => {
            // If there's a custom redraw handler, call it
            if (e.target.redrawEdge) {
                e.target.redrawEdge(e.clientX + projectArea.scrollLeft, e.clientY + projectArea.scrollTop);
            }
        });

        this.nodes = {};
        PERT.currentStats = null;
    }

    /**
     * The plain object representation of the project's configuration DataStore.
     * @returns {Object}
     */
    get configData()
    {
        return this.config.getData();
    }

    /**
     * Whether or not the project has been started.
     * @returns {Boolean}
     */
    get isStarted()
    {
        return this.config.has('original');
    }

    /**
     * Whether or not the project's and all nodes' start and end dates have
     * been set.
     * @returns {Boolean}
     */
    get hasAllDates()
    {
        const config = this.configData;
        let hasAllDates = !!config.start && !!config.end;
        for (const key in config.nodes) {
            hasAllDates = hasAllDates && !!config.nodes[key].start && !!config.nodes[key].end;
        }
        return hasAllDates;
    }

    /**
     * Commits any changes made to the project.
     */
    save()
    {
        if (this.isStarted && !this.hasAllDates) {
            alert('Started projects must have their dates and all their nodes\' start and end dates set to be saved.');
            return;
        }
        this.config.get('stats').modifiedAt = Date.now();
        this.config.commit();
    }

    /**
     * Opens the project rename dialog and renames the project.
     */
    rename()
    {
        const newName = PERT.Dashboard.getNewProjectName(true);

        if (newName !== null) {
            PERT.config.reset();
            PERT.config.set(newName, this.configData);
            PERT.config.unset(this.name);
            PERT.config.commit();
            PERT.Dashboard.redrawProjectsSelector();
            PERT.Dashboard.loadProject(newName);
        }
    }

    /**
     * Opens the project delete dialog and deletes the project.
     */
    delete()
    {
        if (confirm('Are you sure you want to delete the current project? This action cannot be undone.')) {
            PERT.Dashboard.deleteProject(this.name);
        }
    }

    /**
     * Opens the project start dialog and starts the project, preserving an
     * immutable copy of the current state.
     */
    start()
    {
        if (this.isStarted) {
            alert('The project has already been started.');
            return;
        }
        const config = this.configData;
        if (!this.hasAllDates) {
            alert('Please set the project\'s and all nodes\' start and end dates before starting the project.');
            return;
        }
        if (confirm('Are you sure you want to start the current project? Once started, all future modifications will \
become a part of the requirement changes report.')) {
            this.config.set('original', {
                resources: this.config.deepCopy(config.resources),
                nodes: this.config.deepCopy(config.nodes),
                edges: this.config.deepCopy(config.edges),
                start: config.start,
                end: config.end
            });
            this.recalculateDateAdvancement();
        }

    }

    /**
     * Exports the project to a file.
     */
    export()
    {
        // Prepare the project configuration, so it can be loaded as a base64
        // encoded string, so that it can be used as a link's href
        const json = JSON.stringify(this.configData);
        const blob = new Blob([json], {type: 'application/json'});
        const reader = new FileReader();
        reader.addEventListener('load', e => {
            // Create a download link and automatically invoke it
            const link = document.createElement('a');
            link.download = `${this.name}.pert`;
            link.href = e.target.result;
            link.click();
        });
        reader.readAsDataURL(blob);
    }

    /**
     * Opens the node add dialog and creates a new node.
     */
    addNode()
    {
        let name, promptText = '';
        for (;;) {
            promptText += 'Please enter a name for the new milestone:';
            name = prompt(promptText, name);
            if (name === null) {
                return;
            } else if (name === '') {
                promptText = 'The new milestone name cannot be empty.\n';
            } else {
                break;
            }
        }

        const nodes = this.config.ns('nodes');

        // Make sure the new node ID does not overlap with a deleted node if the
        // project is started.
        const unset = [];
        let id;
        do {
            id = nodes.findFreeKey('n');
            nodes.set(id, {});
            unset.push(id);

            // Skip original node IDs
        } while (this.isStarted && id in this.configData.original.nodes);

        // Clean up
        unset.slice(0, -1).forEach(id => nodes.unset(id));

        this.nodes[id] = new PERT.Node(id, nodes.ns(id), name);

        this.recalculateDateConstraints();
    }

    /**
     * Draws all nodes, edges and stats.
     */
    drawElements()
    {
        const nodes = this.config.ns('nodes');
        const edges = this.config.get('edges');
        for (const id of nodes.keys()) {
            this.nodes[id] = new PERT.Node(id, nodes.ns(id));
        }
        for (const id in edges) {
            this.nodes[edges[id].from].connect(id, this.nodes[edges[id].to]);
        }
        this.redrawStats();
        this.recalculateDateConstraints();

        // Recalculate date advancement on the day following
        const tomorrow = new Date();
        tomorrow.setUTCHours(0, 0, 0, 0);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const interval = setInterval(() => {
            // Stop interval if the project has been unloaded
            if (PERT.currentProject !== this) {
                clearInterval(interval);
            }
            if (tomorrow < new Date()) {
                // Bump next update to the day following
                tomorrow.setDate(tomorrow.getDate() + 1);
                this.recalculateDateAdvancement();
            }
        }, 50);
    }

    /**
     * Removes the supplied node from the project.
     * @param {String} id
     */
    deleteNode(id)
    {
        delete this.nodes[id];
        this.config.ns('nodes').unset(id);
        this.recalculateDateConstraints();
        this.recalculateResourceConstraints();
    }

    /**
     * Creates the inputs for provided project resource.
     * @param {String} [id]
     */
    createResourceInputs(id)
    {
        // If no ID has been supplied, create a new placeholder resource
        if (typeof id !== 'string') {
            const resources = this.config.ns('resources');

            // Make sure the new resource ID does not overlap with a deleted
            // resource if the project is started.
            const unset = [];
            do {
                id = resources.findFreeKey('r');
                resources.set(id, {});
                unset.push(id);

                // Skip original resource IDs
            } while (this.isStarted && id in this.configData.original.resources);

            // Clean up
            unset.forEach(id => resources.unset(id));
        }

        const config = this.config.ns('resources').getData();
        const template = PERT.ui('templates').import.querySelector('#ResourceTemplate').content;
        const resource = document.importNode(template, true).firstElementChild;

        // Pre-fill the inputs
        const inputs = resource.querySelectorAll('input');
        inputs[0].value = config[id] ? config[id].name : '';
        inputs[0].addEventListener('change', e => this.updateResource(id, e.target));

        inputs[1].value = config[id] ? config[id].amount : '';
        inputs[1].addEventListener('change', e => this.updateResource(id, e.target));

        inputs[2].value = config[id] ? config[id].concurrency : '';
        inputs[2].addEventListener('change', e => this.updateResource(id, e.target));

        PERT.ui('menu-contents-project').querySelector('.project-resources').appendChild(resource);
    }

    /**
     * Handles any project resource changes.
     * @param {String} id
     * @param {HTMLElement} element
     */
    updateResource(id, element)
    {
        const resources = this.config.ns('resources');
        const type = element.name;
        let value = element.value;

        // All fields that do not represent a name, should be a positive float
        if (type !== 'name') {
            value = Math.max(0, parseFloat(value) || 0);
        }

        // If the changed resource was a placeholder, register it as a new
        // resource, and create a new placeholder
        if (!resources.has(id)) {
            resources.set(id, {name: null, amount: null, concurrency: null});
            this.createResourceInputs();
        }

        // If the resource name was deleted, delete the resource
        if (type === 'name' && value === '') {
            if (confirm('Are you sure you want to delete this resource?')) {
                resources.unset(id);
                element.parentNode.parentNode.removeChild(element.parentNode);
            } else {
                element.value = resources.get(id)[type];
            }
        } else {
            element.value = resources.get(id)[type] = value;
        }

        // Update all node resource fields
        for (const id in this.nodes) {
            this.nodes[id].update();
        }
    }

    /**
     * Recalculates and sets the minimum and maximum values for all project and
     * node dates.
     */
    recalculateDateConstraints()
    {
        // Reset the project date constraints
        const project = PERT.ui('menu-contents-project').querySelectorAll('.project-dates input');
        Object.assign(project[0], project[1], {min: '', max: ''});

        // Reset all nodes' date constraints and find the left and rightmost
        // nodes
        const left = [], right = [];
        for (const nodeId in this.nodes) {
            const node = this.nodes[nodeId];
            Object.assign(node.dateInputs[0], node.dateInputs[1], {min: '', max: ''});
            if (!node.getNeighbours(true).length) {
                left.push(node);
            }
            if (!node.getNeighbours().length) {
                right.push(node);
            }
        }

        // Recalculate all node date constraints
        left.forEach(node => node.updateDateConstraints(false, project[0].value));
        right.forEach(node => node.updateDateConstraints(true, project[1].value));

        // Recalculate the project's date constraints
        // Set the maximum project start date to be the earliest node start time
        left.forEach(node => {
            const value = node.dateInputs[0].value || node.dateInputs[1].value || node.dateInputs[1].max;
            if (!project[0].max || (value && project[0].max > value)) {
                project[0].max = value;
            }
        });

        // Set the minimum project end date to be the latest node end time
        right.forEach(node => {
            const value = node.dateInputs[1].value || node.dateInputs[0].value || node.dateInputs[0].min;
            if (!project[1].min || (value && project[1].min < value)) {
                project[1].min = value;
            }
        });
        this.recalculateResourceConstraints();
        this.recalculateDateAdvancement();
    }

    /**
     * Recalculate all resource constraints.
     */
    recalculateResourceConstraints()
    {
        // Order nodes by date
        const nodes = this.config.get('nodes');
        const nodesOrdered = this
            .config
            .ns('nodes')
            .keys()
            .sort((a, b) => (nodes[a].start || nodes[a].end) > (nodes[b].start || nodes[b].end) ? 1 : -1);
        const resources = this.config.get('resources');

        // Copy resource amounts and concurrency information
        const resourcesLeft = {}, concurrencies = {};
        for (const resourceId in resources) {
            resourcesLeft[resourceId] = resources[resourceId].amount;
            concurrencies[resourceId] = resources[resourceId].concurrency;
        }

        // Collect all milestone start and end events, and determine if there
        // are enough resources to complete each milestone
        const events = [];
        for (const nodeId of nodesOrdered) {
            const node = nodes[nodeId];
            if (!(nodeId in this.nodes)) {
                continue;
            }
            const nodeElement = this.nodes[nodeId].node;
            const resourceCells = nodeElement.querySelectorAll('.node-resources td');

            // Remove any previous indication of insufficient resources
            nodeElement.classList.remove('red');

            for (const resourceId in node.resources) {
                if (!(resourceId in resources)) {
                    continue;
                }

                // Deduct the required resource amount from the global available
                resourcesLeft[resourceId] -= node.resources[resourceId];

                // Find the input node offset for the resource name (index) and
                // value(index + 1)
                const index = Object.keys(node.resources).indexOf(resourceId) * 2;

                // If the milestone requires the resource and there is none
                // available, mark the node and resource inputs as insufficient
                if (node.resources[resourceId] > 0 && resourcesLeft[resourceId] < 0) {
                    resourceCells[index].classList.add('red');
                    resourceCells[index + 1].classList.add('red');
                    nodeElement.classList.add('red');

                    resourceCells[index].title = resourceCells[index + 1].title = 'Insufficient resources';
                } else {
                    // Remove any previous indication of insufficient resources
                    resourceCells[index].classList.remove('red');
                    resourceCells[index + 1].classList.remove('red');

                    resourceCells[index].title = resourceCells[index + 1].title = '';
                }

                // Collect milestone start and end events
                if (resources[resourceId].concurrency && node.resources[resourceId] > 0) {
                    const dates = this.nodes[nodeId].dateInputs;
                    events.push({nodeId, resourceId, start: true, time: dates[0].value || dates[1].min});
                    events.push({nodeId, resourceId, start: false, time: dates[1].value || dates[0].max || 'z'});
                }
            }
        }

        // Sort events by date, priority and level
        events.sort((a, b) => {
            if (a.time !== b.time) {
                return a.time > b.time ? 1 : -1;
            }
            if (a.start !== b.start) {
                return a.start ? 1 : -1;
            }
            if (nodes[a.nodeId].critical !== nodes[b.nodeId].critical) {
                return nodes[a.nodeId].critical ? -1 : 1;
            }
            return this.nodes[a.nodeId].level() > this.nodes[b.nodeId].level() ? 1 : -1;
        }).forEach(({nodeId, resourceId, start}) => {
            // Add or subtract a concurrency point based on whether the event
            // starts or ends
            concurrencies[resourceId] += start ? -1 : 1;

            // If the event is starting, but there are no concurrency points
            // available, mark the node and resource inputs as insufficient
            if (concurrencies[resourceId] < 0 && start) {
                const node = nodes[nodeId];
                const nodeElement = document.getElementById(nodeId);
                const resourceCells = nodeElement.querySelectorAll('.node-resources td');

                // Find the input node offset for the resource name (index) and
                // value(index + 1)
                const index = Object.keys(node.resources).indexOf(resourceId) * 2;
                resourceCells[index].classList.add('red');
                resourceCells[index+1].classList.add('red');
                nodeElement.classList.add('red');

                if (resourceCells[index].title) {
                    resourceCells[index].title = resourceCells[index + 1].title += ' and concurrency';
                } else {
                    resourceCells[index].title = resourceCells[index + 1].title = 'Insufficient concurrency';
                }
            }
        });
    }

    /**
     * Calculate node colors for started projects.
     */
    recalculateDateAdvancement()
    {
        if (!this.isStarted) {
            return;
        }

        // Get today's date without the time component
        const now = new Date();
        now.setUTCHours(0, 0, 0, 0);
        for (const nodeId in this.nodes) {
            const node = this.nodes[nodeId].node;
            node.classList.remove('node-past');
            node.classList.remove('node-upcoming');
            node.classList.remove('node-current');

            const dates = this.nodes[nodeId].dateInputs;
            const start = new Date(dates[0].value);
            const end = new Date(dates[1].value);
            if (now > end) {
                node.classList.add('node-past');
            } else if (now < start) {
                node.classList.add('node-upcoming');
            } else {
                node.classList.add('node-current');
            }
        }
    }

    /**
     * Calculates the resources cost until a provided date.
     * @param {String} date
     * @returns {Object}
     */
    costUntil(date)
    {
        let resourcesSpent = {};

        for (const nodeId in this.nodes) {
            if (this.nodes[nodeId].configData.from > date) {
                continue;
            }
            resourcesSpent = PERT.sumObjects(resourcesSpent, this.nodes[nodeId].cost());
        }
        return resourcesSpent;
    }

    /**
     * Redraws the cumulative resource cost statistics for the supplied node or
     * until the project end.
     * @param {String} [nodeId]
     */
    redrawStats(nodeId)
    {
        const stats = nodeId ? this.nodes[nodeId].cost(true) : this.costUntil(this.config.get('end'));
        const resources = this.config.get('resources');
        const statArea = PERT.ui('menu-contents-project').querySelector('.project-stats');

        statArea.innerHTML = '';
        for (const key in stats) {
            const row = document.createElement('tr');
            [resources[key].name, stats[key]]
                .map(value => {
                    const td = document.createElement('td');
                    td.innerText = value;
                    return td;
                })
                .forEach(td => row.appendChild(td));
            statArea.appendChild(row);
        }
    }
};
